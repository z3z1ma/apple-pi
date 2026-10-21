import { randomUUID } from "node:crypto";
import { defineTool, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { loadRoles, managesPeople, organizationOf } from "../../organization/src/index.js";
import { sendCommand } from "./client.js";
import type { Command, Receipt } from "./protocol.js";

const TOOLS = [
	"start_peer_session",
	"reopen_peer_session",
	"close_peer_session",
	"rename_peer_session",
	"transfer_peer_session",
	"retire_peer_session",
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

/** Peer management tools, active only in a session whose role manages. */
export function installCoordinator(pi: ExtensionAPI): void {
	pi.registerTool(
		defineTool({
			name: "start_peer_session",
			label: "start_peer_session",
			description:
				"Hire a person: start a new peer session, a top-level Pi session in its own tmux window next to yours, which reports to you (it mails you when it closes, and list_peer_sessions shows you as its manager). Give it a role from the catalog; it keeps that role, mind, and posture for life. Its session-title extension assigns a unique two-part human name automatically. Returns once the session is running. Pass a brief file as the prompt with @path.",
			parameters: Type.Object(
				{
					cwd: Type.String({ minLength: 1, description: "Directory the session works in." }),
					role: Type.Optional(
						Type.String({ minLength: 1, description: "Role catalog name, such as staff-engineer-simplicity." }),
					),
					prompt: Type.Optional(Type.String({ description: "First prompt, such as @/path/to/brief.md." })),
					session_id: Type.Optional(Type.String({ description: "Session id to use; a new one by default." })),
				},
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const sessionId = params.session_id ?? randomUUID();
				if (params.role) {
					const catalog = loadRoles(ctx.cwd);
					if (!catalog.roles.has(params.role))
						throw new Error(`Unknown role "${params.role}"; known roles: ${[...catalog.roles.keys()].join(", ")}.`);
				}
				await run(
					sessionId,
					{
						kind: "start",
						tmux: ownPane(),
						cwd: params.cwd,
						reportsTo: ctx.sessionManager.getSessionId(),
						...(params.role ? { role: params.role } : {}),
						...(params.prompt ? { prompt: params.prompt } : {}),
					},
					signal,
				);
				return reply(`Started session ${sessionId}${params.role ? ` as ${params.role}` : ""}.`, { sessionId });
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "reopen_peer_session",
			label: "reopen_peer_session",
			description:
				"Reopen a stopped peer session by id in a new tmux window next to yours, in its own directory and with its full history; it reports to you. Give it new work by mail, not its first brief again. Returns once the session is running.",
			parameters: Type.Object(
				{ session_id: Type.String({ minLength: 1, description: "Id of the stopped session." }) },
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				await run(
					params.session_id,
					{ kind: "start", tmux: ownPane(), reportsTo: ctx.sessionManager.getSessionId() },
					signal,
				);
				return reply(`Reopened session ${params.session_id}.`, { sessionId: params.session_id });
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "close_peer_session",
			label: "close_peer_session",
			description:
				"Close a running peer session by id: its Pi process quits, and it can be reopened later with its history. Check first with list_peer_sessions that it is idle; closing a busy session stops its work.",
			parameters: Type.Object(
				{ session_id: Type.String({ minLength: 1, description: "Id of the running session." }) },
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal) {
				await run(params.session_id, { kind: "close" }, signal);
				return reply(`Closed session ${params.session_id}.`, { sessionId: params.session_id });
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "rename_peer_session",
			label: "rename_peer_session",
			description:
				"Rename a running peer session by id. Use list_peer_sessions to find its id; its id and history stay the same.",
			parameters: Type.Object(
				{
					session_id: Type.String({ minLength: 1, description: "Id of the running session." }),
					name: Type.String({ minLength: 1, description: "New session name." }),
				},
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal) {
				await run(params.session_id, { kind: "rename", name: params.name }, signal);
				return reply(`Renamed session ${params.session_id} to ${params.name}.`, { sessionId: params.session_id });
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "transfer_peer_session",
			label: "transfer_peer_session",
			description:
				"Move a person under another manager in your organization; a manager moves with its whole team. From then on the person takes work from, reports to, and escalates to the new manager. The move is refused when it would make a cycle or leave the organization. The person and both managers get mail naming the move.",
			parameters: Type.Object(
				{
					session_id: Type.String({ minLength: 1, description: "Id of the person to move." }),
					manager: Type.String({ minLength: 1, description: "Session id of the new manager." }),
				},
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const by = ctx.sessionManager.getSessionId();
				const from = organizationOf(by).members.find((member) => member.id === params.session_id)?.reportsTo;
				await run(params.session_id, { kind: "transfer", manager: params.manager, by }, signal);
				const note = (text: string) => ({
					kind: "mail" as const,
					from: by,
					body: text,
					sentAt: new Date().toISOString(),
				});
				const mails = [
					sendCommand(
						params.session_id,
						note(
							`You now report to ${params.manager}: take work from, report to, and escalate to that session from now on.`,
						),
						{ signal, until: "accepted" },
					),
					sendCommand(
						params.manager,
						note(`${params.session_id} now reports to you${from ? ` (moved from ${from})` : ""}.`),
						{ signal, until: "accepted" },
					),
					...(from && from !== by
						? [
								sendCommand(from, note(`${params.session_id} now reports to ${params.manager}, not to you.`), {
									signal,
									until: "accepted",
								}),
							]
						: []),
				];
				await Promise.all(mails);
				return reply(`${params.session_id} now reports to ${params.manager}.`, {
					sessionId: params.session_id,
					manager: params.manager,
					from: from ?? null,
				});
			},
		}),
	);
	pi.registerTool(
		defineTool({
			name: "retire_peer_session",
			label: "retire_peer_session",
			description:
				"Record that a person has left your organization, with the date and reason, and close it if it runs. Its history stays, and the directory lists it among former members; reopen_peer_session brings it back. Retire reluctantly: a person's accumulated context is expensive to rebuild.",
			parameters: Type.Object(
				{
					session_id: Type.String({ minLength: 1, description: "Id of the person." }),
					reason: Type.String({ minLength: 1, description: "Why it leaves, in one sentence." }),
				},
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal) {
				await run(params.session_id, { kind: "retire", reason: params.reason }, signal);
				return reply(`${params.session_id} retired: ${params.reason}`, { sessionId: params.session_id });
			},
		}),
	);
	const reconcile = (ctx: ExtensionContext) => {
		const active = pi.getActiveTools();
		const next = managesPeople(pi, ctx)
			? [...new Set([...active, ...TOOLS])]
			: active.filter((name) => !TOOLS.includes(name));
		if (next.length !== active.length) pi.setActiveTools(next);
	};
	pi.on("session_start", (_event, ctx) => reconcile(ctx));
	pi.on("before_agent_start", (_event, ctx) => reconcile(ctx));
}
