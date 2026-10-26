import { randomUUID } from "node:crypto";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolvePerson } from "./addresses.js";
import { sendCommand } from "./client.js";
import { realizedFitness } from "./fitness.js";
import { areasOf, expertsOn, type Scope, waitsIn, workIn } from "./inspect.js";
import { ENTITY_KINDS, type Entity, type Link, relations } from "./links.js";
import type { Command } from "./protocol.js";
import { taskOrganization } from "./tree.js";
import { goalText, rootOf, taskIdOf, type WorkAction, type WorkTask, withWork } from "./work.js";

const PERSON_TASK_TOOLS = [
	"take_task",
	"focus",
	"finish_task",
	"promote_task",
	"link",
	"fitness",
	"org_expertise",
	"org_waits",
	"org_work",
];
const UNITS: Record<string, number> = { m: 60_000, h: 3_600_000, d: 86_400_000 };

/** A time as a span back from now (`30m`, `8h`, `7d`) or a date. */
function pointInTime(text: string, now: number): number {
	const span = text.trim().match(/^(\d+(?:\.\d+)?)\s*([mhd])$/);
	if (span) return now - Number(span[1]) * UNITS[span[2]];
	const date = Date.parse(text);
	if (Number.isNaN(date)) throw new Error(`Give a time as 30m, 8h, 7d, or a date (got "${text}")`);
	return date;
}
export const TASK_GOAL_CUSTOM_TYPE = "apple-pi.task-goal";
const taskParameter = Type.String({ minLength: 1, description: "Task id or path to its bundle or task.md." });
export const goalTitle = Type.String({
	minLength: 1,
	description: "A short title for the goal, a few words, as it shows in lists. Required with goal.",
});
/** What a new goal is worth, written into its task.md as the writer's estimate. */
export const goalWorth = {
	value: Type.Optional(
		Type.Number({
			minimum: 0,
			description:
				"With a goal: what the finished work is worth, in dollars, as your estimate. Splitting work never adds value; give each part its share.",
		}),
	),
	cost_of_delay: Type.Optional(
		Type.Number({
			minimum: 0,
			description: "With a goal: dollars the work loses for each hour it stays unfinished.",
		}),
	),
};
const goalOrTask = {
	goal: Type.Optional(
		Type.String({ minLength: 1, description: "A written goal for a new ephemeral task. Give goal or task, not both." }),
	),
	title: Type.Optional(goalTitle),
	task: Type.Optional(taskParameter),
	...goalWorth,
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

function entity(ctx: ExtensionContext, ref: string): Entity {
	const split = ref.indexOf(":");
	const kind = ref.slice(0, split);
	const id = ref.slice(split + 1).trim();
	if (split < 1 || !id) throw new Error(`Name a thing as kind:id, such as task:work-1 or person:Ada (got "${ref}")`);
	if (kind === "person") return { kind, id: resolvePerson(ctx.sessionManager.getSessionId(), id) };
	if (kind === "task") {
		const task = withWork((db) => taskIdOf(db, ctx.cwd, id));
		if (!task) throw new Error("The runtime has no tasks yet");
		return { kind, id: task };
	}
	return { kind, id };
}

async function changeLink(
	ctx: ExtensionContext,
	args: {
		id?: string;
		resolution?: string;
		from?: string;
		to?: string;
		relation?: string;
		reason?: string;
		data?: unknown;
		inferred?: boolean;
		confidence?: number;
	},
	signal: AbortSignal | undefined,
) {
	const hasLinks = () =>
		withWork((db) => Boolean(db.prepare("select 1 from sqlite_master where name = 'links' and type = 'table'").get()));
	if (!hasLinks()) throw new Error("The runtime predates links; restart it before recording one.");
	const commandId = randomUUID();
	const command: Command = args.id
		? { kind: "link_resolve", id: args.id, ...(args.resolution ? { resolution: args.resolution } : {}) }
		: {
				kind: "link_record",
				from: entity(ctx, args.from ?? ""),
				to: entity(ctx, args.to ?? ""),
				relation: args.relation ?? "",
				reason: args.reason,
				data: args.data,
				inferred: args.inferred,
				confidence: args.confidence,
			};
	const receipt = await sendCommand(ctx.sessionManager.getSessionId(), command, { commandId, signal });
	if (receipt.stage === "failed") throw new Error(receipt.reason);
	const link = withWork((db) => db.prepare("select * from links where id = ?").get(args.id ?? commandId)) as
		| Link
		| undefined;
	if (!link) throw new Error("The runtime returned no link");
	const verb = link.resolved_at === null ? "Recorded" : "Resolved";
	return {
		content: [
			{
				type: "text" as const,
				text: `${verb} link ${link.id}: ${link.from_kind}:${link.from_id} ${link.relation} ${link.to_kind}:${link.to_id}`,
			},
		],
		details: link,
	};
}

function readExpertise(
	ctx: ExtensionContext,
	args: { area?: string; person?: string; since?: string; until?: string; subtree?: string },
) {
	if (Boolean(args.area) === Boolean(args.person)) throw new Error("Give exactly one of area or person");
	const now = Date.now();
	const self = ctx.sessionManager.getSessionId();
	const window = {
		cwd: ctx.cwd,
		from: args.since ? pointInTime(args.since, now) : undefined,
		to: args.until ? pointInTime(args.until, now) : undefined,
		subtree: args.subtree ? resolvePerson(self, args.subtree) : undefined,
	};
	const when = (at: number) => new Date(at).toISOString();
	const found = withWork((db) => {
		const organization = rootOf(db, self);
		if (args.person) {
			const person = resolvePerson(self, args.person);
			const areas = areasOf(db, organization, person, window);
			return {
				details: { person: `person:${person}`, areas },
				lines: [
					`Areas where person:${person} made read or edit calls, most touched first:`,
					...areas.map((a) => `- ${a.ref}: ${a.reads} reads, ${a.edits} edits, last ${when(a.lastTouch)}`),
				],
			};
		}
		const people = expertsOn(db, organization, args.area!, window);
		return {
			details: { area: args.area, people },
			lines: [
				`People who made read or edit calls in ${args.area}, most touched first:`,
				...people.map(
					(p) =>
						`- ${p.ref} (${p.status}${p.compactionSince ? ", a compaction started since" : ""}): ${p.reads} reads, ${p.edits} edits, last ${when(p.lastTouch)}${p.tasks.length ? `; tasks ${p.tasks.map((t) => `${t.ref}${t.title ? ` "${t.title}"` : ""}${t.finished ? ` (finished: ${t.outcome?.split("\n")[0] ?? ""})` : ""}`).join(", ")}` : ""}`,
				),
			],
		};
	});
	if (!found) throw new Error("The runtime has no records yet");
	return { content: [{ type: "text" as const, text: found.lines.join("\n") }], details: found.details };
}

/** One optional scope for an inspection: a person's subtree, a person, or a task. */
function scopeOf(ctx: ExtensionContext, args: { subtree?: string; person?: string; task?: string }): Scope {
	const given = [args.subtree, args.person, args.task].filter(Boolean).length;
	if (given > 1) throw new Error("Give at most one of subtree, person, or task");
	const self = ctx.sessionManager.getSessionId();
	// A scope names someone or something in the caller's own organization.
	const ours = (person: string) => {
		if (withWork((db) => rootOf(db, person) !== rootOf(db, self)))
			throw new Error(`${person} is not in your organization`);
		return person;
	};
	if (args.subtree) return { subtree: ours(resolvePerson(self, args.subtree)) };
	if (args.person) return { person: ours(resolvePerson(self, args.person)) };
	if (args.task) {
		const ref = args.task.replace(/^task:/, "");
		const task = withWork((db) => {
			const id = taskIdOf(db, ctx.cwd, ref);
			if (taskOrganization(db, id) !== rootOf(db, self)) throw new Error(`${ref} is not a task of your organization`);
			return id;
		});
		if (!task) throw new Error("The runtime has no tasks yet");
		return { task };
	}
	return {};
}

function readWaits(
	ctx: ExtensionContext,
	args: { since?: string; until?: string; subtree?: string; person?: string; task?: string },
) {
	const now = Date.now();
	const self = ctx.sessionManager.getSessionId();
	const scope = scopeOf(ctx, args);
	const window = {
		cwd: ctx.cwd,
		from: args.since ? pointInTime(args.since, now) : undefined,
		to: args.until ? pointInTime(args.until, now) : now,
	};
	const waits = withWork((db) => waitsIn(db, rootOf(db, self), window, scope));
	if (!waits) throw new Error("The runtime has no records yet");
	const line = (w: (typeof waits.targets)[number]["waits"][number]) =>
		`  - ${w.ref}: ${w.from} ${w.relation} ${w.to}, open ${w.ageHours.toFixed(1)}h, waiting: ${w.waiters.join(", ")}, recorded by ${w.recordedBy}${w.crossesTeams ? ", crosses teams" : ""}${w.reason ? ` (${w.reason})` : ""}`;
	const lines = [
		`Open waits: ${waits.open}, on ${waits.targets.length} targets, most waited-on first.`,
		...waits.targets.flatMap((t) => [`- ${t.ref}: ${t.waits.length} waiting`, ...t.waits.map(line)]),
		...(window.from === undefined
			? []
			: [
					`Resolved in the window (unblocked): ${waits.unblocked.length}`,
					...waits.unblocked.map(
						(w) =>
							`  - ${w.ref}: ${w.from} ${w.relation} ${w.to}, waited ${w.ageHours.toFixed(1)}h, resolved ${new Date(w.resolvedAt).toISOString()}${w.reason ? ` (${w.reason})` : ""}`,
					),
				]),
	];
	return { content: [{ type: "text" as const, text: lines.join("\n") }], details: waits };
}

function readFitness(ctx: ExtensionContext, args: { since: string; until?: string; subtree?: string }) {
	const now = Date.now();
	const from = pointInTime(args.since, now);
	const to = args.until ? pointInTime(args.until, now) : now;
	if (!(from < to)) throw new Error("The window must start before it ends");
	if (to > now) throw new Error("Realized fitness covers the past; end the window now or earlier");
	const self = ctx.sessionManager.getSessionId();
	const subtree = args.subtree ? resolvePerson(self, args.subtree) : undefined;
	const fitness = withWork((db) => realizedFitness(db, rootOf(db, self), from, to, { subtree }));
	if (!fitness) throw new Error("The runtime has no tasks yet");
	const dollars = (n: number) => `$${n.toFixed(2)}`;
	const lines = [
		`Realized fitness ${dollars(fitness.total)} (${dollars(fitness.perHour)} per hour) from ${new Date(from).toISOString()} to ${new Date(to).toISOString()}${fitness.incomplete ? "; incomplete: some work has no value" : ""}.`,
		`Value earned ${dollars(fitness.value)}, delay ${dollars(fitness.delay)}, compute ${dollars(fitness.compute)}, impacts ${dollars(fitness.impact)}.`,
		`Tasks in the window: ${fitness.coverage.tasks}, unvalued ${fitness.coverage.unvalued}; ${Math.round(fitness.coverage.estimatedValueShare * 100)}% of value is agents' estimates.`,
		`Delay by state: queued ${dollars(fitness.delayByState.queued)} (needs people), waiting ${dollars(fitness.delayByState.waiting)} (needs a decision or another task), in progress ${dollars(fitness.delayByState.inProgress)}.`,
		`Not counted yet: ${fitness.excludes}.`,
		`Interruptions of the operator: ${fitness.interruptions}; the operator's time is priced at $${fitness.attention.pricePerMinute}/minute but not measured, so it is not in the total.`,
		...fitness.openWaits.map(
			(w) =>
				`- open wait ${w.id}: ${w.from_kind}:${w.from_id} ${w.relation} ${w.to_kind}:${w.to_id}, ${w.ageHours.toFixed(1)}h${w.reason ? ` (${w.reason})` : ""}`,
		),
		...fitness.contributions.map(
			(c) =>
				`- ${c.source}: value ${dollars(c.value)}, delay ${dollars(c.delay)}, compute ${dollars(c.compute)}, impact ${dollars(c.impact)}`,
		),
	];
	return { content: [{ type: "text" as const, text: lines.join("\n") }], details: fitness };
}

export function installWork(pi: ExtensionAPI): void {
	pi.registerTool(
		defineTool({
			name: "org_work",
			label: "org_work",
			description:
				"See where work stands: ready without an owner, waiting on explicit links, or held without an open wait. Shows task age, holders and people holding several tasks. Give since for arrivals and closes (done or cancelled) in a window; until selects the snapshot time. Narrow to a subtree, person or task. Read-only facts with task/person/link references, not a judgment of productivity.",
			promptSnippet: "Inspect ready work, waiting work, assignments and arrivals versus completions.",
			parameters: Type.Object(
				{
					since: Type.Optional(
						Type.String({ minLength: 1, description: "List arrivals and closes since: 30m, 8h, 7d, or a date." }),
					),
					until: Type.Optional(Type.String({ minLength: 1, description: "Snapshot time; now by default." })),
					subtree: Type.Optional(Type.String({ minLength: 1 })),
					person: Type.Optional(Type.String({ minLength: 1 })),
					task: Type.Optional(Type.String({ minLength: 1 })),
				},
				{ additionalProperties: false },
			),
			execute: async (_id, args, _signal, _update, ctx) => {
				const now = Date.now();
				const from = args.since ? pointInTime(args.since, now) : undefined;
				const to = args.until ? pointInTime(args.until, now) : now;
				if (to > now || (from !== undefined && from >= to))
					throw new Error("Choose a past window whose start precedes its end");
				const scope = scopeOf(ctx, args);
				const result = withWork((db) =>
					workIn(db, rootOf(db, ctx.sessionManager.getSessionId()), { cwd: ctx.cwd, from, to }, scope),
				);
				if (!result) throw new Error("The runtime has no records yet");
				const lines = [
					...(["ready", "waiting", "inProgress"] as const).flatMap((state) => [
						`${state}: ${result[state].length}`,
						...result[state].map(
							(task) =>
								`- ${task.ref}: ${task.ageHours.toFixed(1)}h old; holders: ${task.holders.join(", ") || "none"}${task.waits.length ? `; waits: ${task.waits.join(", ")}` : ""}`,
						),
					]),
					...result.multiple.map(
						(load) => `- ${load.person} holds ${load.tasks.length} tasks: ${load.tasks.join(", ")}`,
					),
					...(from === undefined
						? []
						: [
								`Opened: ${result.opened.length}; closed done: ${result.closed.filter((task) => task.status === "done").length}; cancelled: ${result.closed.filter((task) => task.status === "cancelled").length}`,
								...result.opened.map((task) => `- opened ${task.ref} at ${new Date(task.at).toISOString()}`),
								...result.closed.map((task) => `- ${task.status} ${task.ref} at ${new Date(task.at).toISOString()}`),
							]),
				];
				return { content: [{ type: "text" as const, text: lines.join("\n") }], details: result };
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "org_waits",
			label: "org_waits",
			description:
				"What blocks what: the organization's open waits (blocks and requires_decision links), grouped by what they wait on, the most waited-on first, each with what waits, why, for how long, who recorded it, and whether it crosses teams (neither manages the other and they have different managers). Give since to also list waits resolved in that window. Narrow to a person's subtree, a person, or a task. Facts with references, never a verdict.",
			promptSnippet: "See what is blocked, on what, and for how long.",
			parameters: Type.Object(
				{
					since: Type.Optional(
						Type.String({ minLength: 1, description: "Also list waits resolved since: 30m, 8h, 7d, or a date." }),
					),
					until: Type.Optional(Type.String({ minLength: 1, description: "Look as of this time instead of now." })),
					subtree: Type.Optional(
						Type.String({ minLength: 1, description: "Only waits involving this person's subtree." }),
					),
					person: Type.Optional(Type.String({ minLength: 1, description: "Only waits involving this person." })),
					task: Type.Optional(Type.String({ minLength: 1, description: "Only waits from or to this task." })),
				},
				{ additionalProperties: false },
			),
			execute: async (_id, args, _signal, _update, ctx) => readWaits(ctx, args),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "org_expertise",
			label: "org_expertise",
			description:
				"Who knows what, from the read and edit calls people made (counted whether or not they succeeded). Give an area (a path or directory, relative to your directory or absolute, or a word found in paths) to list the people who touched it: reads, edits, last touch, the tasks they held then, whether they are working, idle, at home, or left, and whether a compaction of their session started since. Or give a person to list the directories it touched. Facts sorted by activity, never a verdict on who is best; narrow by area or window.",
			promptSnippet: "Find who has context on an area, or what a person knows.",
			parameters: Type.Object(
				{
					area: Type.Optional(Type.String({ minLength: 1, description: "A path, directory, or word in paths." })),
					person: Type.Optional(Type.String({ minLength: 1, description: "A person, by name or id." })),
					since: Type.Optional(
						Type.String({ minLength: 1, description: "Only touches after: 30m, 8h, 7d, or a date." }),
					),
					until: Type.Optional(Type.String({ minLength: 1, description: "Only touches before, in the same form." })),
					subtree: Type.Optional(Type.String({ minLength: 1, description: "Only people in this person's subtree." })),
				},
				{ additionalProperties: false },
			),
			execute: async (_id, args, _signal, _update, ctx) => readExpertise(ctx, args),
		}),
	);
	pi.registerTool(
		defineTool({
			name: "fitness",
			label: "fitness",
			description:
				"Read your organization's realized fitness in dollars over a window you name: value earned when tasks completed, minus delay accrued while valued work was outstanding, minus compute. Shows the rate per hour, each task's and person's contribution, and how much work has no value yet. Narrow the contributions to one person's subtree to explain its part; the total stays the organization's.",
			promptSnippet: "Read the organization's realized fitness and what contributes to it.",
			parameters: Type.Object(
				{
					since: Type.String({ minLength: 1, description: "Start: a span back from now (30m, 8h, 7d) or a date." }),
					until: Type.Optional(Type.String({ minLength: 1, description: "End, in the same form; now by default." })),
					subtree: Type.Optional(
						Type.String({ minLength: 1, description: "Show only contributions of this person's subtree." }),
					),
				},
				{ additionalProperties: false },
			),
			execute: async (_id, args, _signal, _update, ctx) => readFitness(ctx, args),
		}),
	);
	const vocabulary = Object.entries(relations())
		.map(([word, meaning]) => `${word}: ${meaning}`)
		.join(" ");
	pi.registerTool(
		defineTool({
			name: "link",
			executionMode: "sequential",
			label: "link",
			description: `Record a relationship between two things, or resolve one by id. Name each thing as kind:id with kind one of ${ENTITY_KINDS.join(", ")} (a task by id or ledger path, a person by name or id, a commit by SHA, a PR by URL, a file by path, a check run by its command and time or CI URL, the organization by its root's id). Relations: ${vocabulary} A wait (blocks, requires_decision) on a task ends on its own when that task closes done; resolve any other link yourself.`,
			promptSnippet: "Record or resolve a link between tasks, people, threads, and results.",
			parameters: Type.Object(
				{
					id: Type.Optional(Type.String({ minLength: 1, description: "Resolve this link instead of recording one." })),
					resolution: Type.Optional(
						Type.String({
							minLength: 1,
							description: "With id: a word for how it ended, such as accepted or rejected.",
						}),
					),
					from: Type.Optional(Type.String({ minLength: 3, description: "The first thing, as kind:id." })),
					to: Type.Optional(Type.String({ minLength: 3, description: "The second thing, as kind:id." })),
					relation: Type.Optional(Type.String({ minLength: 1, description: "A relation from the list." })),
					reason: Type.Optional(Type.String({ description: "A short reason or evidence reference." })),
					data: Type.Optional(Type.Unknown({ description: "Structured data, such as an impact or a scenario." })),
					inferred: Type.Optional(
						Type.Boolean({ description: "True when you infer the relationship rather than know it." }),
					),
					confidence: Type.Optional(
						Type.Number({ minimum: 0, maximum: 1, description: "With inferred: how sure you are, 0 to 1." }),
					),
				},
				{ additionalProperties: false },
			),
			execute: (_id, args, signal, _update, ctx) => changeLink(ctx, args, signal),
		}),
	);
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
