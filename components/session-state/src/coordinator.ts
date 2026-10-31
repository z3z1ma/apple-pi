import { randomUUID } from "node:crypto";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadRoles, managesPeople, organizationOf } from "../../organization/src/index.js";
import { resolvePerson } from "./addresses.js";
import { sendCommand } from "./client.js";
import { departureOf } from "./departures.js";
import type { Command, Receipt } from "./protocol.js";
import { focusedTask, withWork } from "./work.js";
import { goalTitle, goalWorth, installAssignments, requireTitle } from "./work-tools.js";

const MANAGER_TOOLS = ["hire", "call_in", "send_home", "rename", "move", "let_go", "assign", "unassign"];

/** The tmux pane this session runs in, which new windows open next to. */
function ownPane(): { socket: string; pane: string } | undefined {
	const socket = process.env.TMUX?.split(",")[0];
	const pane = process.env.TMUX_PANE;
	if (!socket || !pane) return undefined;
	return { socket, pane };
}

async function run(
	sessionId: string,
	command: Command,
	signal: AbortSignal | undefined,
	until: "accepted" | "applied" = "applied",
): Promise<Receipt> {
	const receipt = await sendCommand(sessionId, command, { signal, until });
	if (receipt.stage === "failed") throw new Error(`${command.kind} ${sessionId} failed: ${receipt.reason}`);
	return receipt;
}

const reply = (text: string, details: Record<string, unknown>) => ({
	content: [{ type: "text" as const, text }],
	details,
});

const personParameter = Type.String({
	minLength: 1,
	description: "The person: a name in your organization or a session id.",
});

/** Manager tools follow the shared management capability gate. */
export function installCoordinator(pi: ExtensionAPI): void {
	installAssignments(pi);
	pi.registerTool(
		defineTool({
			name: "hire",
			label: "hire",
			description:
				"Hire a person into your organization: a new lasting colleague, a top-level Pi session in its own tmux window next to yours (headless outside tmux), which reports to you (directory shows you as its manager, and it mails you when it closes). It holds its role, mind, and posture for life, and receives a unique two-part human name unless you give one. Its role is its standing job. Give a goal and title to assign an initial task, or omit the goal to bring the person in idle for later work. Returns once the person connects.",
			parameters: Type.Object(
				{
					role: Type.String({ minLength: 1, description: "Role catalog name, such as staff-engineer-simplicity." }),
					specialization: Type.Optional(
						Type.String({
							description:
								"Optional lasting focus within this role, set at creation. The person keeps all role responsibilities.",
						}),
					),
					cwd: Type.Optional(
						Type.String({ minLength: 1, description: "Directory the person works in; yours by default." }),
					),
					goal: Type.Optional(
						Type.String({
							description:
								"Optional initial task, with context and what done looks like. Omit to bring the person in idle.",
						}),
					),
					title: Type.Optional(goalTitle),
					...goalWorth,
					name: Type.Optional(Type.String({ minLength: 1, description: "A name to give instead of a drawn one." })),
					session_id: Type.Optional(Type.String({ description: "Session id to use; a new one by default." })),
				},
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const goal = params.goal?.trim();
				requireTitle(goal, params.title);
				const sessionId = params.session_id ?? randomUUID();
				if (
					withWork(
						(db) => db.prepare("select 1 from sessions where id = ?").get(sessionId) || departureOf(db, sessionId),
					)
				)
					throw new Error(
						"This identity already exists or has permanently left; call in an existing member or hire a new identity.",
					);
				const catalog = loadRoles(ctx.cwd);
				if (!catalog.roles.has(params.role))
					throw new Error(`Unknown role "${params.role}"; known roles: ${[...catalog.roles.keys()].join(", ")}.`);
				const specialization = params.specialization?.trim();
				if (
					specialization &&
					!withWork((db) =>
						db.prepare("select 1 from pragma_table_info('sessions') where name = 'specialization'").get(),
					)
				)
					throw new Error("Restart the session runtime before hiring with a specialization.");
				await run(
					sessionId,
					{
						kind: "start",
						tmux: ownPane(),
						cwd: params.cwd ?? ctx.cwd,
						reportsTo: ctx.sessionManager.getSessionId(),
						role: params.role,
						...(specialization ? { specialization } : {}),
						...(params.name ? { name: params.name } : {}),
						...(goal
							? {
									goal: {
										text: goal,
										by: ctx.sessionManager.getSessionId(),
										title: params.title,
										value: params.value,
										cost_of_delay: params.cost_of_delay,
									},
								}
							: { prompt: "" }),
					},
					signal,
				);
				return reply(`Hired ${params.name ?? "a new person"} (${sessionId}) as ${params.role}.`, {
					sessionId,
					task: withWork((db) => focusedTask(db, sessionId)),
				});
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "call_in",
			label: "call_in",
			description:
				"Call in a person you sent home: it reopens in a new tmux window next to yours (headless outside tmux), in its own directory and with its full history, and reports to you. An optional goal becomes a new assigned task; otherwise it keeps its existing work. Returns once it runs.",
			parameters: Type.Object(
				{
					person: personParameter,
					goal: Type.Optional(
						Type.String({ minLength: 1, description: "New work to assign before the person starts." }),
					),
					title: Type.Optional(goalTitle),
					...goalWorth,
				},
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				requireTitle(params.goal, params.title);
				const self = ctx.sessionManager.getSessionId();
				const id = resolvePerson(self, params.person);
				const left = withWork((db) =>
					Boolean(db.prepare("select 1 from sessions where id = ? and retired_at is not null").get(id)),
				);
				if (left) throw new Error(`${params.person} has left the organization; hire a new person.`);
				await run(
					id,
					{
						kind: "start",
						tmux: ownPane(),
						reportsTo: self,
						...(params.goal
							? {
									goal: {
										text: params.goal,
										by: self,
										title: params.title,
										value: params.value,
										cost_of_delay: params.cost_of_delay,
									},
								}
							: {}),
					},
					signal,
				);
				return reply(`${params.person} is back (${id}).`, { sessionId: id });
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "send_home",
			label: "send_home",
			description:
				"Send a person home: its Pi process quits, it stays in your organization at home, and call_in brings it back with its history. Check first with directory that it is idle; sending a working person home stops its work.",
			parameters: Type.Object({ person: personParameter }, { additionalProperties: false }),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const id = resolvePerson(ctx.sessionManager.getSessionId(), params.person);
				await run(id, { kind: "close" }, signal);
				return reply(`${params.person} went home (${id}).`, { sessionId: id });
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "rename",
			label: "rename",
			description: "Give a running person a new name. Its id and history stay the same.",
			parameters: Type.Object(
				{ person: personParameter, name: Type.String({ minLength: 1, description: "The new name." }) },
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const id = resolvePerson(ctx.sessionManager.getSessionId(), params.person);
				await run(id, { kind: "rename", name: params.name }, signal);
				return reply(`${params.person} is now ${params.name}.`, { sessionId: id });
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "move",
			label: "move",
			description:
				"Move a person under another manager in your organization; a manager moves with its whole team. From then on the person takes work from, reports to, and escalates to the new manager. The move is refused when it would make a cycle or leave the organization. The person and both managers get one mail naming the move.",
			parameters: Type.Object(
				{
					person: personParameter,
					manager: Type.String({ minLength: 1, description: "The new manager: a name or a session id." }),
				},
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const by = ctx.sessionManager.getSessionId();
				const id = resolvePerson(by, params.person);
				const manager = resolvePerson(by, params.manager);
				const from = organizationOf(by).members.find((member) => member.id === id)?.reportsTo;
				await run(id, { kind: "transfer", manager, by }, signal);
				const told = [...new Set([id, manager, ...(from ? [from] : [])])].filter((who) => who !== by);
				await run(
					by,
					{
						kind: "thread_post",
						thread: `t-${randomUUID().slice(0, 8)}`,
						subject: `${params.person} moves to ${params.manager}`,
						body: `${params.person} now reports to ${params.manager}${from ? ` (moved from ${from})` : ""}: take work from, report to, and escalate to that manager from now on.`,
						to: told,
					},
					signal,
				);
				return reply(`${params.person} now reports to ${params.manager}.`, {
					sessionId: id,
					manager,
					from: from ?? null,
				});
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "let_go",
			label: "let_go",
			description:
				"Request permanent departure after finishing or explicitly reassigning the person's assignments, moving its reports and settling its program delegations. Returns an accepted request ID, not completion. By default the runtime asks its own session for a final handoff and saves a private durable Markdown file. Set handoff:false to skip that model turn and file, without waking a sleeping person. Both paths commit departure and retry safe process/file/private-record cleanup. You and its manager receive progress and any handoff pointer. Caller disconnection leaves accepted work running; handoff failure preserves the person and transcript. Shared organizational evidence remains. Hire a new person for later work.",
			parameters: Type.Object(
				{
					person: personParameter,
					reason: Type.String({ minLength: 1, description: "Why it leaves, in one sentence." }),
					handoff: Type.Optional(
						Type.Boolean({
							default: true,
							description:
								"Ask the departing person to write a final handoff. False skips the model turn and handoff file and can stop an active turn; responsibility and cleanup checks still apply.",
						}),
					),
				},
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const id = resolvePerson(ctx.sessionManager.getSessionId(), params.person);
				const receipt = await run(
					id,
					{
						kind: "retire",
						reason: params.reason,
						by: ctx.sessionManager.getSessionId(),
						handoff: params.handoff ?? true,
					},
					signal,
					"accepted",
				);
				return reply(
					`Departure request accepted for ${params.person}; ${params.handoff === false ? "no handoff requested; cleanup runs" : "handoff and cleanup run"} asynchronously. Request: ${receipt.commandId}`,
					{
						sessionId: id,
						commandId: receipt.commandId,
						stage: receipt.stage,
					},
				);
			},
		}),
	);
	const reconcile = (ctx: ExtensionContext) => {
		const active = pi.getActiveTools();
		const next = managesPeople(ctx)
			? [...new Set([...active, ...MANAGER_TOOLS])]
			: active.filter((name) => !MANAGER_TOOLS.includes(name));
		if (next.length !== active.length) pi.setActiveTools(next);
	};
	pi.on("session_start", (_event, ctx) => reconcile(ctx));
	pi.on("before_agent_start", (_event, ctx) => reconcile(ctx));
}
