import { randomUUID } from "node:crypto";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolvePerson } from "./addresses.js";
import { sendCommand } from "./client.js";
import { goalText, type WorkAction, type WorkTask, withWork } from "./work.js";

const PERSON_TASK_TOOLS = ["take_task", "focus", "finish_task", "promote_task"];
export const TASK_GOAL_CUSTOM_TYPE = "apple-pi.task-goal";
const taskParameter = Type.String({ minLength: 1, description: "Task id or path to its bundle or task.md." });
export const goalTitle = Type.String({
	minLength: 1,
	description: "A short title for the goal, a few words, as it shows in lists. Required with goal.",
});
const goalOrTask = {
	goal: Type.Optional(
		Type.String({ minLength: 1, description: "A written goal for a new ephemeral task. Give goal or task, not both." }),
	),
	title: Type.Optional(goalTitle),
	task: Type.Optional(taskParameter),
};

/** A goal needs its own short title: the goal's text is too long to name the task wherever it is listed. */
export function requireTitle(goal: string | undefined, title: string | undefined): void {
	if (goal && !title?.trim()) throw new Error("Give a short title with the goal.");
}

async function change(ctx: ExtensionContext, command: WorkAction, signal: AbortSignal | undefined) {
	if (!ctx.isProjectTrusted()) throw new Error("Task changes require a trusted project");
	if (command.action === "take" || command.action === "assign") requireTitle(command.goal, command.title);
	if (withWork(() => true) === undefined)
		throw new Error("The runtime predates assignments; restart it before using task tools.");
	const commandId = randomUUID();
	const receipt = await sendCommand(
		ctx.sessionManager.getSessionId(),
		{ ...command, kind: "work", cwd: ctx.cwd },
		{ commandId, signal },
	);
	if (receipt.stage === "failed") throw new Error(receipt.reason);
	const task = withWork(
		(db) =>
			db
				.prepare("select t.* from work_tasks t join work_changes c on c.task_id = t.id where c.command_id = ?")
				.get(commandId) as unknown as WorkTask,
	);
	if (!task) throw new Error("The runtime returned no task for this change");
	const person = "person" in command && command.person ? command.person : ctx.sessionManager.getSessionId();
	const goal = person === ctx.sessionManager.getSessionId() ? goalText(person) : undefined;
	return {
		content: [
			{
				type: "text" as const,
				text: `${command.action}: ${task.id}\nGoal: ${task.bundle}/task.md\nThread: ${task.thread}${goal ? `\n\n${goal}` : ""}`,
			},
		],
		details: task,
	};
}

export function installWork(pi: ExtensionAPI): void {
	pi.registerTool(
		defineTool({
			name: "take_task",
			executionMode: "sequential",
			label: "take_task",
			description:
				"Take responsibility for work: give a goal to create an ephemeral task, or take an existing unassigned task by id or ledger path. It becomes your focused task; your manager hears through its task thread. Every task has a task.md goal and a retrospective, even informal work. You can hold several tasks, with one in focus.",
			promptSnippet: "Take a goal or existing task; it becomes your focused work.",
			promptGuidelines: [
				"Take new work from the operator as a task before working, unless it is already assigned to you. Edit task.md to change the goal, then focus it again to reread it. Finish the retrospective before finish_task.",
			],
			parameters: Type.Object(goalOrTask, { additionalProperties: false }),
			execute: (_id, args, signal, _update, ctx) => change(ctx, { action: "take", ...args }, signal),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "focus",
			executionMode: "sequential",
			label: "focus",
			description:
				"Focus one of your assigned tasks. Rereads its task.md and appends the goal to your context, including edits made since you last focused it.",
			parameters: Type.Object({ task: taskParameter }, { additionalProperties: false }),
			execute: (_id, args, signal, _update, ctx) => change(ctx, { action: "focus", ...args }, signal),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "finish_task",
			executionMode: "sequential",
			label: "finish_task",
			description:
				"Finish your focused assignment: write the outcome into task.md, end your assignment, clear focus, and report the outcome to everyone in its task thread. Say what you verified and what you believe. A finished ephemeral task is archived with its retrospective once all assignees have finished; a ledger bundle stays under its ledger status workflow.",
			parameters: Type.Object(
				{ outcome: Type.String({ minLength: 1, description: "The outcome and verification, in your own words." }) },
				{ additionalProperties: false },
			),
			execute: (_id, args, signal, _update, ctx) => change(ctx, { action: "finish", ...args }, signal),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "promote_task",
			executionMode: "sequential",
			label: "promote_task",
			description:
				"Move a live ephemeral task into its project's .ledger with an index row. Its files, assignments, focus, and thread follow it. Optional title and description give the ledger's one-line title and search summary; otherwise its heading supplies both.",
			parameters: Type.Object(
				{ task: taskParameter, title: Type.Optional(Type.String()), description: Type.Optional(Type.String()) },
				{ additionalProperties: false },
			),
			execute: (_id, args, signal, _update, ctx) => change(ctx, { action: "promote", ...args }, signal),
		}),
	);
	const activate = () => {
		const active = pi.getActiveTools();
		const next = [...new Set([...active, ...PERSON_TASK_TOOLS])];
		if (next.length !== active.length) pi.setActiveTools(next);
	};
	pi.on("session_start", activate);
	pi.on("before_agent_start", activate);
	pi.on("session_compact", (_event, ctx) => {
		const text = goalText(ctx.sessionManager.getSessionId());
		if (text)
			pi.sendMessage(
				{ customType: TASK_GOAL_CUSTOM_TYPE, content: text, display: false },
				{ deliverAs: "steer", triggerTurn: false },
			);
	});
}

export function installAssignments(pi: ExtensionAPI): void {
	pi.registerTool(
		defineTool({
			name: "assign",
			executionMode: "sequential",
			label: "assign",
			description:
				"Assign a person in your organization a task or a plain goal. It becomes their focused work, with a goal file and a shared task thread. A person at home is called in and begins; an awake person receives it at the next safe boundary. It keeps its other assignments.",
			parameters: Type.Object(
				{
					person: Type.String({ minLength: 1, description: "A name in your organization or session id." }),
					...goalOrTask,
				},
				{ additionalProperties: false },
			),
			execute: (_id, args, signal, _update, ctx) =>
				change(
					ctx,
					{ ...args, action: "assign", person: resolvePerson(ctx.sessionManager.getSessionId(), args.person) },
					signal,
				),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "unassign",
			executionMode: "sequential",
			label: "unassign",
			description:
				"Take an assignment back from a person. The assignment ends without being marked finished; the task stays available. The person and task participants hear the change, and its focus clears if it was on that task.",
			parameters: Type.Object(
				{ person: Type.String({ minLength: 1 }), task: taskParameter },
				{ additionalProperties: false },
			),
			execute: (_id, args, signal, _update, ctx) =>
				change(
					ctx,
					{ ...args, action: "unassign", person: resolvePerson(ctx.sessionManager.getSessionId(), args.person) },
					signal,
				),
		}),
	);
}
