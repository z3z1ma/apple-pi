import { randomUUID } from "node:crypto";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadRoles, managesPeople, organizationOf } from "../../organization/src/index.js";
import { resolvePerson } from "./addresses.js";
import { sendCommand } from "./client.js";
import { installMeetings } from "./meetings.js";
import type { Command, Receipt } from "./protocol.js";
import { focusedTask, withWork } from "./work.js";
import { installAssignments } from "./work-tools.js";

const MANAGER_TOOLS = [
	"hire",
	"rehire",
	"send_home",
	"rename",
	"move",
	"let_go",
	"meet",
	"end_meeting",
	"assign",
	"unassign",
];

/** The tmux pane this session runs in, which new windows open next to. */
function ownPane(): { socket: string; pane: string } {
	const socket = process.env.TMUX?.split(",")[0];
	const pane = process.env.TMUX_PANE;
	if (!socket || !pane)
		throw new Error("This session does not run in tmux, so it cannot open a window for another one.");
	return { socket, pane };
}

async function run(sessionId: string, command: Command, signal: AbortSignal | undefined): Promise<Receipt> {
	const receipt = await sendCommand(sessionId, command, { signal });
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

/** The manager tools, active only in a root session or one whose role manages. */
export function installCoordinator(pi: ExtensionAPI): void {
	installMeetings(pi);
	installAssignments(pi);
	pi.registerTool(
		defineTool({
			name: "hire",
			label: "hire",
			description:
				"Hire a person into your organization: a new lasting colleague, a top-level Pi session in its own tmux window next to yours, which reports to you (directory shows you as its manager, and it mails you when it closes). It holds its role, mind, and posture for life, and receives a unique two-part human name unless you give one. Give a written goal: an ephemeral task is assigned before its first turn. Returns once the person runs.",
			parameters: Type.Object(
				{
					role: Type.String({ minLength: 1, description: "Role catalog name, such as staff-engineer-simplicity." }),
					cwd: Type.Optional(
						Type.String({ minLength: 1, description: "Directory the person works in; yours by default." }),
					),
					goal: Type.String({
						minLength: 1,
						description: "The written goal to assign, with context and what done looks like.",
					}),
					name: Type.Optional(Type.String({ minLength: 1, description: "A name to give instead of a drawn one." })),
					session_id: Type.Optional(Type.String({ description: "Session id to use; a new one by default." })),
				},
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const sessionId = params.session_id ?? randomUUID();
				if (withWork((db) => db.prepare("select 1 from sessions where id = ?").get(sessionId)))
					throw new Error("This person already exists; use rehire.");
				const catalog = loadRoles(ctx.cwd);
				if (!catalog.roles.has(params.role))
					throw new Error(`Unknown role "${params.role}"; known roles: ${[...catalog.roles.keys()].join(", ")}.`);
				await run(
					sessionId,
					{
						kind: "start",
						tmux: ownPane(),
						cwd: params.cwd ?? ctx.cwd,
						reportsTo: ctx.sessionManager.getSessionId(),
						role: params.role,
						...(params.name ? { name: params.name } : {}),
						goal: { text: params.goal, by: ctx.sessionManager.getSessionId() },
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
			name: "rehire",
			label: "rehire",
			description:
				"Bring back a person who is asleep or has left: it reopens in a new tmux window next to yours, in its own directory and with its full history, and reports to you. An optional goal becomes a new assigned task; otherwise it keeps its existing work. Returns once it runs.",
			parameters: Type.Object(
				{
					person: personParameter,
					goal: Type.Optional(
						Type.String({ minLength: 1, description: "New work to assign before the person wakes." }),
					),
				},
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const self = ctx.sessionManager.getSessionId();
				const id = resolvePerson(self, params.person);
				await run(
					id,
					{
						kind: "start",
						tmux: ownPane(),
						reportsTo: self,
						...(params.goal ? { goal: { text: params.goal, by: self } } : {}),
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
				"Send a person home: its Pi process quits, it stays in your organization asleep, and rehire brings it back with its history. Check first with directory that it is idle; sending a working person home stops its work.",
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
				"Let a person go: record that it left your organization, with the date and reason, and close it if it runs. Its history stays, the directory lists it among former members, and rehire brings it back. Let go reluctantly: a person's accumulated context is expensive to rebuild.",
			parameters: Type.Object(
				{
					person: personParameter,
					reason: Type.String({ minLength: 1, description: "Why it leaves, in one sentence." }),
				},
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const id = resolvePerson(ctx.sessionManager.getSessionId(), params.person);
				await run(id, { kind: "retire", reason: params.reason }, signal);
				return reply(`${params.person} left: ${params.reason}`, { sessionId: id });
			},
		}),
	);
	const reconcile = (ctx: ExtensionContext) => {
		const active = pi.getActiveTools();
		const next = managesPeople(pi, ctx)
			? [...new Set([...active, ...MANAGER_TOOLS])]
			: active.filter((name) => !MANAGER_TOOLS.includes(name));
		if (next.length !== active.length) pi.setActiveTools(next);
	};
	pi.on("session_start", (_event, ctx) => reconcile(ctx));
	pi.on("before_agent_start", (_event, ctx) => reconcile(ctx));
}
