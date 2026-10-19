// The conversation reader: pages a character's conversation through the runtime's socket (`read_entries`, which reads
// the session's JSONL once per page) and marks a character seen with `mark_seen`, waiting for its receipt. It keeps one
// connection of its own, opened on first use and again after the runtime went away; it never starts a runtime.
import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import type { CommandResult, ConversationPage, TranscriptEntry } from "../world.js";
import { transcriptEntry } from "./transcript.js";

/** Entries per page: about a screen and a half of a busy session, read in one pass of its transcript. */
export const PAGE_SIZE = 50;
/** A page of a long transcript can take a while to read; a command is answered at once. */
const PAGE_TIMEOUT_MS = 20_000;
const COMMAND_TIMEOUT_MS = 5000;
const GONE = "The session runtime is not answering.";

export interface Conversations {
	/** The newest page of a session's conversation, or the page just before the entry `before`. */
	page(sessionId: string, before?: string): Promise<ConversationPage>;
	/** Send `mark_seen` for the session; resolves once the runtime applied it or says why it failed. */
	markSeen(sessionId: string): Promise<CommandResult>;
	close(): void;
}

type Reply = Record<string, unknown> & { type?: string };

export function openConversations(socketPath: string): Conversations {
	let socket: Socket | undefined;
	let connecting: Promise<Socket> | undefined;
	let closed = false;
	// What each request waits for, by request or command id; the handler returns true once it is settled.
	const waiting = new Map<string, { onReply(reply: Reply): boolean; onGone(): void }>();

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
					let reply: Reply;
					try {
						reply = JSON.parse(line) as Reply;
					} catch {
						continue;
					}
					const key = String(reply.requestId ?? reply.commandId ?? "");
					const handler = waiting.get(key);
					if (handler?.onReply(reply)) waiting.delete(key);
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
				for (const [key, handler] of waiting) {
					waiting.delete(key);
					handler.onGone();
				}
			});
		});
		return connecting;
	};

	/** Write `message` and wait for `settle` to turn a reply about `key` into a result. */
	async function ask<T>(
		key: string,
		message: unknown,
		timeoutMs: number,
		settle: (reply: Reply) => T | undefined,
		failed: (reason: string) => T,
	): Promise<T> {
		if (closed) return failed(GONE);
		let open: Socket;
		try {
			open = await connect();
		} catch {
			return failed(GONE);
		}
		return new Promise<T>((resolve) => {
			const timer = setTimeout(() => {
				waiting.delete(key);
				resolve(failed(GONE));
			}, timeoutMs);
			const done = (result: T) => {
				clearTimeout(timer);
				resolve(result);
			};
			waiting.set(key, {
				onReply(reply) {
					const result = settle(reply);
					if (result === undefined) return false;
					done(result);
					return true;
				},
				onGone: () => done(failed(GONE)),
			});
			open.write(`${JSON.stringify(message)}\n`);
		});
	}

	return {
		page(sessionId, before) {
			const requestId = `agent-world-${randomUUID()}`;
			return ask<ConversationPage>(
				requestId,
				{ type: "read_entries", requestId, sessionId, limit: PAGE_SIZE, ...(before ? { before } : {}) },
				PAGE_TIMEOUT_MS,
				(reply) => {
					if (reply.type !== "entries") return undefined;
					if (typeof reply.error === "string") return { ok: false, reason: reply.error };
					const entries = (Array.isArray(reply.entries) ? reply.entries : [])
						.map(transcriptEntry)
						.filter((entry): entry is TranscriptEntry => entry !== undefined);
					return {
						ok: true,
						entries,
						before: typeof reply.before === "string" ? reply.before : null,
						missing: Array.isArray(reply.missing) ? reply.missing.length : 0,
					};
				},
				(reason) => ({ ok: false, reason }),
			);
		},
		markSeen(sessionId) {
			const commandId = `agent-world-${randomUUID()}`;
			return ask<CommandResult>(
				commandId,
				{ type: "command", commandId, sessionId: sessionId, command: { kind: "mark_seen" } },
				COMMAND_TIMEOUT_MS,
				(reply) => {
					if (reply.type !== "receipt") return undefined;
					if (reply.stage === "applied") return { ok: true };
					if (reply.stage === "failed") return { ok: false, reason: String(reply.reason ?? "failed") };
					return undefined;
				},
				(reason) => ({ ok: false, reason }),
			);
		},
		close() {
			closed = true;
			socket?.destroy();
		},
	};
}
