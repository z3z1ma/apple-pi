// The command client: sends session-state commands over the runtime's socket and reports each receipt stage as it
// arrives (accepted, delivered, applied, failed; `docs/session-state.md`, Commands). It keeps one connection of its
// own, opened on first use and again after the runtime went away; it never starts a runtime. Any Agent World module
// that acts on a session (the conversation panel's instructions, waking, mail) sends through it.
import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { isDeepStrictEqual } from "node:util";
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
	request: unknown;
	socket: Socket;
	promise: Promise<CommandResult>;
	listeners: Set<NonNullable<SendOptions["onReceipt"]>>;
	stage?: ReceiptStage;
	reason?: string;
	settle(result: CommandResult): void;
}

export function openCommands(socketPath: string): Commands {
	let socket: Socket | undefined;
	let connecting: Promise<Socket> | undefined;
	let closed = false;
	const waiting = new Map<string, Waiting>();

	function receive(line: string, source: Socket) {
		let reply: { type?: unknown; commandId?: unknown; stage?: unknown; reason?: unknown };
		try {
			reply = JSON.parse(line);
		} catch {
			return;
		}
		if (reply?.type !== "receipt" || typeof reply.commandId !== "string") return;
		const handler = waiting.get(reply.commandId);
		if (!handler || handler.socket !== source) return;
		const stage = reply.stage;
		if (stage !== "accepted" && stage !== "delivered" && stage !== "applied" && stage !== "failed") return;
		const reason = typeof reply.reason === "string" ? reply.reason : undefined;
		handler.stage = stage;
		handler.reason = reason;
		for (const listener of handler.listeners) listener(stage, stage === "failed" ? (reason ?? "failed") : reason);
		if (stage === "applied") handler.settle({ ok: true });
		else if (stage === "failed") handler.settle({ ok: false, reason: reason ?? "failed" });
	}

	const connect = (): Promise<Socket> => {
		if (socket && !socket.destroyed) return Promise.resolve(socket);
		connecting ??= new Promise<Socket>((resolve, reject) => {
			const next = createConnection(socketPath);
			let buffer = "";
			next.on("data", (chunk) => {
				buffer += chunk.toString();
				for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
					receive(buffer.slice(0, end), next);
					buffer = buffer.slice(end + 1);
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
					if (handler.socket === next) handler.settle({ ok: false, reason: handler.stage ? LOST : GONE });
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
			const request = JSON.parse(JSON.stringify({ sessionId, command })) as unknown;
			const previous = waiting.get(commandId);
			if (previous && !previous.socket.destroyed) {
				if (!isDeepStrictEqual(previous.request, request))
					return { ok: false, reason: "This command ID is already waiting for a different request." };
				if (options.onReceipt) {
					previous.listeners.add(options.onReceipt);
					if (previous.stage) options.onReceipt(previous.stage, previous.reason);
				}
				return previous.promise;
			}
			previous?.settle({ ok: false, reason: previous.stage ? LOST : GONE });
			let resolveResult!: (result: CommandResult) => void;
			const promise = new Promise<CommandResult>((resolve) => {
				resolveResult = resolve;
			});
			const timer = setTimeout(() => {
				if (!handler.stage) handler.settle({ ok: false, reason: GONE });
			}, ACCEPT_TIMEOUT_MS);
			const handler: Waiting = {
				request,
				socket: open,
				promise,
				listeners: new Set(options.onReceipt ? [options.onReceipt] : []),
				settle(result) {
					if (waiting.get(commandId) !== handler) return;
					waiting.delete(commandId);
					clearTimeout(timer);
					resolveResult(result);
				},
			};
			waiting.set(commandId, handler);
			open.write(`${JSON.stringify({ type: "command", commandId, sessionId, command })}\n`);
			return promise;
		},
		close() {
			closed = true;
			socket?.destroy();
		},
	};
}
