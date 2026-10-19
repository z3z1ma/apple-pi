import { randomUUID } from "node:crypto";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { sendCommand } from "./client.js";
import type { Command, Receipt } from "./protocol.js";

const TOOLS = ["start_peer_session", "reopen_peer_session", "close_peer_session"];

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

/** Tools to start, reopen, and close peer sessions in tmux, active only in a session started with `--coordinator`. */
export function installCoordinator(pi: ExtensionAPI): void {
	pi.registerTool(
		defineTool({
			name: "start_peer_session",
			label: "start_peer_session",
			description:
				"Start a new peer session: a top-level Pi session in its own tmux window next to yours, which reports to you (it mails you when it closes, and list_peer_sessions shows you as its supervisor). Returns once the session is running. Pass a brief file as the prompt with @path.",
			parameters: Type.Object(
				{
					cwd: Type.String({ minLength: 1, description: "Directory the session works in." }),
					name: Type.String({ minLength: 1, description: "Short name, also the tmux window name." }),
					prompt: Type.Optional(Type.String({ description: "First prompt, such as @/path/to/brief.md." })),
					session_id: Type.Optional(Type.String({ description: "Session id to use; a new one by default." })),
				},
				{ additionalProperties: false },
			),
			async execute(_toolCallId, params, signal, _onUpdate, ctx) {
				const sessionId = params.session_id ?? randomUUID();
				await run(
					sessionId,
					{
						kind: "start",
						tmux: ownPane(),
						cwd: params.cwd,
						name: params.name,
						reportsTo: ctx.sessionManager.getSessionId(),
						...(params.prompt ? { prompt: params.prompt } : {}),
					},
					signal,
				);
				return reply(`Started session ${sessionId} (${params.name}).`, { sessionId });
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
	const reconcile = () => {
		const active = pi.getActiveTools();
		const next =
			pi.getFlag("coordinator") === true
				? [...new Set([...active, ...TOOLS])]
				: active.filter((name) => !TOOLS.includes(name));
		if (next.length !== active.length) pi.setActiveTools(next);
	};
	pi.on("session_start", reconcile);
	pi.on("before_agent_start", reconcile);
}
