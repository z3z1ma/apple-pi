// The command client: sends session-state commands over the runtime's socket and reports each receipt stage as it
// arrives (accepted, delivered, applied, failed; `docs/session-state.md`, Commands). It keeps one connection of its
// own, opened on first use and again after the runtime went away; it never starts a runtime. Any Agent World module
// that acts on a session (the conversation panel's instructions, waking, mail) sends through it.
import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import type { Command } from "../../../../components/session-state/src/protocol.js";
import type { CommandResult, ReceiptStage } from "../world.js";

/** The runtime answers `accepted` at once; without it this soon, it is not answering. */
const ACCEPT_TIMEOUT_MS = 5000;
const GONE = "The session runtime is not answering.";
const LOST = "The session runtime went away before the command finished; it may still have been applied.";

export interface SendOptions {
	/** The command's id; a new one by default. Sending an id again applies nothing and reports the stage it reached. */
	commandId?: string;
	/** Called with each stage the runtime reports, in order; `failed` comes with its reason. */
	onReceipt?: (stage: ReceiptStage, reason?: string) => void;
}

export interface Commands {
	/** Send `command` to the session; resolves once it is applied or has failed, with the runtime's reason. */
	send(sessionId: string, command: Command, options?: SendOptions): Promise<CommandResult>;
	close(): void;
}

interface Waiting {
	accepted: boolean;
	onReceipt(stage: ReceiptStage, reason?: string): void;
	settle(result: CommandResult): void;
}

export function openCommands(socketPath: string): Commands {
	let socket: Socket | undefined;
	let connecting: Promise<Socket> | undefined;
	let closed = false;
	const waiting = new Map<string, Waiting>();

	const connect = (): Promise<Socket> => {
		if (socket && !socket.destroyed) return Promise.resolve(socket);
		connecting ??= new Promise<Socket>((resolve, reject) => {
			const next = createConnection(socketPath);
			let buffer = "";
			next.on("data", (chunk) => {
				buffer += chunk.toString();
				for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
					const line = buffer.slice(0, end);
					buffer = buffer.slice(end + 1);
					let reply: { type?: unknown; commandId?: unknown; stage?: unknown; reason?: unknown };
					try {
						reply = JSON.parse(line);
					} catch {
						continue;
					}
					if (reply.type !== "receipt" || typeof reply.commandId !== "string") continue;
					const handler = waiting.get(reply.commandId);
					if (!handler) continue;
					const stage = reply.stage as ReceiptStage;
					const reason = typeof reply.reason === "string" ? reply.reason : undefined;
					if (stage === "accepted") handler.accepted = true;
					handler.onReceipt(stage, stage === "failed" ? (reason ?? "failed") : reason);
					if (stage === "applied") handler.settle({ ok: true });
					else if (stage === "failed") handler.settle({ ok: false, reason: reason ?? "failed" });
				}
			});
			next.once("connect", () => {
				socket = next;
				connecting = undefined;
				resolve(next);
			});
			next.on("error", (error) => {
				if (socket !== next) {
					connecting = undefined;
					reject(error);
				}
			});
			next.on("close", () => {
				if (socket === next) socket = undefined;
				for (const handler of [...waiting.values()])
					handler.settle({ ok: false, reason: handler.accepted ? LOST : GONE });
			});
		});
		return connecting;
	};

	return {
		async send(sessionId, command, options = {}) {
			if (closed) return { ok: false, reason: GONE };
			let open: Socket;
			try {
				open = await connect();
			} catch {
				return { ok: false, reason: GONE };
			}
			const commandId = options.commandId ?? `agent-world-${randomUUID()}`;
			return new Promise<CommandResult>((resolve) => {
				const timer = setTimeout(() => {
					if (!handler.accepted) handler.settle({ ok: false, reason: GONE });
				}, ACCEPT_TIMEOUT_MS);
				const handler: Waiting = {
					accepted: false,
					onReceipt: (stage, reason) => options.onReceipt?.(stage, reason),
					settle(result) {
						if (waiting.get(commandId) !== handler) return;
						waiting.delete(commandId);
						clearTimeout(timer);
						resolve(result);
					},
				};
				waiting.set(commandId, handler);
				open.write(`${JSON.stringify({ type: "command", commandId, sessionId, command })}\n`);
			});
		},
		close() {
			closed = true;
			socket?.destroy();
		},
	};
}
