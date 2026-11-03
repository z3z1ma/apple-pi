import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import type { CommandResult, ConversationPage, ReplyStreamEvent, TranscriptEntry } from "../world.js";
import { transcriptEntry } from "./transcript.js";

export const PAGE_SIZE = 50;
const PAGE_TIMEOUT_MS = 20_000;
const COMMAND_TIMEOUT_MS = 5000;
const GONE = "The session runtime is not answering.";
const SUBSCRIBE_TIMEOUT_MS = 3000;
const RESUBSCRIBE_MS = 1000;

export interface Conversations {
	page(sessionId: string, before?: string, textOnly?: boolean): Promise<ConversationPage>;
	markSeen(sessionId: string): Promise<CommandResult>;
	watch(sessionIds: string[]): Promise<void>;
	onReply(listener: (event: ReplyStreamEvent) => void): () => void;
	close(): void;
}

type Reply = Record<string, unknown> & { type?: string };

function lineReader(): (chunk: Buffer) => string[] {
	let held: Buffer[] = [];
	return (chunk) => {
		const lines: string[] = [];
		let start = 0;
		for (let end = chunk.indexOf(10); end >= 0; end = chunk.indexOf(10, start)) {
			lines.push(Buffer.concat([...held, chunk.subarray(start, end)]).toString());
			held = [];
			start = end + 1;
		}
		if (start < chunk.length) held.push(chunk.subarray(start));
		return lines;
	};
}

export function openConversations(socketPath: string): Conversations {
	let socket: Socket | undefined;
	let connecting: Promise<Socket> | undefined;
	let closed = false;
	const waiting = new Map<string, { onReply(reply: Reply): boolean; onGone(): void }>();

	const connect = (): Promise<Socket> => {
		if (socket && !socket.destroyed) return Promise.resolve(socket);
		connecting ??= new Promise<Socket>((resolve, reject) => {
			const next = createConnection(socketPath);
			const lines = lineReader();
			next.on("data", (chunk) => {
				for (const line of lines(chunk)) {
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

	const readEntry = (sessionId: string, entryId: string) => {
		const requestId = `agent-workplace-${randomUUID()}`;
		return ask<TranscriptEntry | null>(
			requestId,
			{ type: "read_entry", requestId, sessionId, entryId },
			PAGE_TIMEOUT_MS,
			(reply) => (reply.type !== "entry" ? undefined : (transcriptEntry(reply.entry) ?? null)),
			() => null,
		);
	};

	const replyListeners = new Set<(event: ReplyStreamEvent) => void>();
	const emit = (event: ReplyStreamEvent) => {
		for (const listener of replyListeners) listener(event);
	};
	let watched: string[] = [];
	let streams: Socket | undefined;
	let resubscribe: NodeJS.Timeout | undefined;
	let confirmed: { ids: string; done(): void } | undefined;

	const onStreamLine = (reply: Reply) => {
		if (reply.type === "subscribed") {
			if (confirmed && JSON.stringify(reply.sessionIds) === confirmed.ids) confirmed.done();
			return;
		}
		const sessionId = typeof reply.sessionId === "string" ? reply.sessionId : undefined;
		const streamId = typeof reply.streamId === "string" ? reply.streamId : undefined;
		if (!sessionId || !streamId) return;
		if (reply.type === "reply_delta" && typeof reply.delta === "string")
			emit({ kind: "delta", characterId: sessionId, streamId, seq: Number(reply.seq) || 0, delta: reply.delta });
		else if (reply.type === "reply_end") {
			const entryId = typeof reply.messageEntryId === "string" ? reply.messageEntryId : undefined;
			if (!entryId) emit({ kind: "end", characterId: sessionId, streamId, entry: null });
			else
				void readEntry(sessionId, entryId).then((entry) =>
					emit({ kind: "end", characterId: sessionId, streamId, entry }),
				);
		}
	};

	const subscribe = (): Promise<void> =>
		new Promise<void>((resolve) => {
			const ids = JSON.stringify(watched);
			const timer = setTimeout(() => finish(), SUBSCRIBE_TIMEOUT_MS);
			const finish = () => {
				clearTimeout(timer);
				if (confirmed?.done === finish) confirmed = undefined;
				resolve();
			};
			confirmed?.done();
			confirmed = { ids, done: finish };
			const send = (socket: Socket) => socket.write(`${JSON.stringify({ type: "subscribe", sessionIds: watched })}\n`);
			if (streams && !streams.destroyed) {
				send(streams);
				return;
			}
			if (closed || !watched.length) return finish();
			const next = createConnection(socketPath);
			streams = next;
			const lines = lineReader();
			next.on("data", (chunk) => {
				for (const line of lines(chunk)) {
					try {
						onStreamLine(JSON.parse(line) as Reply);
					} catch {}
				}
			});
			next.once("connect", () => send(next));
			next.on("error", () => {});
			next.on("close", () => {
				if (streams !== next) return;
				streams = undefined;
				clearTimeout(resubscribe);
				if (!closed && watched.length) resubscribe = setTimeout(() => void subscribe(), RESUBSCRIBE_MS).unref();
			});
		});

	return {
		page(sessionId, before, textOnly) {
			const requestId = `agent-workplace-${randomUUID()}`;
			return ask<ConversationPage>(
				requestId,
				{
					type: "read_entries",
					requestId,
					sessionId,
					limit: PAGE_SIZE,
					...(before ? { before } : {}),
					...(textOnly ? { textOnly } : {}),
				},
				PAGE_TIMEOUT_MS,
				(reply) => {
					if (reply.type !== "entries") return undefined;
					if (typeof reply.error === "string") return { ok: false, reason: reply.error };
					const reactions = (reply.reactions ?? {}) as Record<string, TranscriptEntry["reactions"]>;
					const entries = (Array.isArray(reply.entries) ? reply.entries : [])
						.map(transcriptEntry)
						.filter((entry): entry is TranscriptEntry => entry !== undefined)
						.map((entry) => (reactions[entry.id] ? { ...entry, reactions: reactions[entry.id] } : entry));
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
			const commandId = `agent-workplace-${randomUUID()}`;
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
		watch(sessionIds) {
			watched = [...new Set(sessionIds)];
			return subscribe();
		},
		onReply(listener) {
			replyListeners.add(listener);
			return () => replyListeners.delete(listener);
		},
		close() {
			closed = true;
			clearTimeout(resubscribe);
			confirmed?.done();
			socket?.destroy();
			streams?.destroy();
			replyListeners.clear();
		},
	};
}
