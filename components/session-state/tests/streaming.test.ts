import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { close, fakeBridge, query, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const cwd = mkdtempSync(join(tmpdir(), "aps-stream-"));
writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
const sessionDir = mkdtempSync(join(tmpdir(), "aps-stream-sessions-"));
beforeAll(() => startRuntime(state.socketPath));
afterAll(async () => {
	await stopRuntime(state);
	rmSync(cwd, { recursive: true, force: true });
	rmSync(sessionDir, { recursive: true, force: true });
});

type Message = Record<string, any>;

/** A client on the socket that collects every line it receives. */
async function client() {
	const socket: Socket = createConnection(state.socketPath);
	await new Promise((resolve) => socket.once("connect", resolve));
	const messages: Message[] = [];
	let buffer = "";
	socket.on("data", (chunk) => {
		buffer += chunk.toString();
		for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
			messages.push(JSON.parse(buffer.slice(0, end)));
			buffer = buffer.slice(end + 1);
		}
	});
	const send = (message: unknown) => socket.write(`${JSON.stringify(message)}\n`);
	return { socket, messages, send };
}

/** A client subscribed to `sessionIds`, once the runtime confirmed it. */
async function subscriber(sessionIds: string[]) {
	const c = await client();
	c.send({ type: "subscribe", sessionIds });
	await vi.waitFor(() => expect(c.messages).toContainEqual({ type: "subscribed", sessionIds }), { timeout: 3000 });
	return c;
}

const streamed = (messages: Message[]) => messages.filter((m) => m.type === "reply_delta" || m.type === "reply_end");
const textOf = (messages: Message[]) =>
	messages
		.filter((m) => m.type === "reply_delta")
		.map((m) => m.delta)
		.join("");

/** A faux session whose reply streams as one delta per block, and its id once the runtime knows it. */
async function streamingSession(blocks: string[]) {
	const run = await fauxSession([bridge], [fauxAssistantMessage(blocks.map((text) => fauxText(text)))], [], {
		streamText: true,
		cwd,
		sessionManager: SessionManager.create(cwd, sessionDir),
	});
	const id = run.session.sessionManager.getSessionId();
	await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = ?", id)).toHaveLength(1), {
		timeout: 15000,
	});
	return { run, id };
}

/** The transcript entry a client reads for `entryId`. */
async function readEntry(sessionId: string, entryId: string) {
	const c = await client();
	c.send({ type: "read_entry", requestId: "r", sessionId, entryId });
	await vi.waitFor(() => expect(c.messages).toHaveLength(1), { timeout: 3000 });
	c.socket.destroy();
	expect(c.messages[0]).toHaveProperty("entry");
	return c.messages[0].entry;
}

test("a subscribed client receives the reply's deltas in order, ending with the stored entry; others receive none", async () => {
	const { run, id } = await streamingSession(["Hello", " there", ", friend."]);
	const subscribed = await subscriber([id]);
	const elsewhere = await subscriber(["some-other-session"]);
	const plain = await client();
	try {
		await run.session.prompt("Say hello.");
		await vi.waitFor(() => expect(streamed(subscribed.messages).at(-1)?.type).toBe("reply_end"), { timeout: 5000 });
		const stream = streamed(subscribed.messages);
		const deltas = stream.filter((m) => m.type === "reply_delta");
		expect(deltas.map((m) => m.delta)).toEqual(["Hello", " there", ", friend."]);
		expect(deltas.map((m) => m.seq)).toEqual([1, 2, 3]);
		for (const m of stream) expect(m).toMatchObject({ sessionId: id, streamId: deltas[0].streamId });
		const end = stream.at(-1)!;
		const entry = await readEntry(id, end.messageEntryId);
		expect(entry.message.role).toBe("assistant");
		expect(entry.message.content.map((block: { text: string }) => block.text).join("")).toBe(textOf(stream));
		expect(streamed(elsewhere.messages)).toEqual([]);
		expect(plain.messages).toEqual([]);
	} finally {
		subscribed.socket.destroy();
		elsewhere.socket.destroy();
		plain.socket.destroy();
		await close(run);
	}
}, 30000);

test("streamed text is never written to events or messages; the entry named at the end holds the full reply", async () => {
	const blocks = ["First line.\n", "UNSTORED-FRAGMENT-1", " and UNSTORED-FRAGMENT-2."];
	const { run, id } = await streamingSession(blocks);
	const subscribed = await subscriber([id]);
	try {
		await run.session.prompt("Go.");
		await vi.waitFor(() => expect(streamed(subscribed.messages).at(-1)?.type).toBe("reply_end"), { timeout: 5000 });
		await vi.waitFor(
			() =>
				expect(query(state.dbPath, "select run_state from sessions where id = ?", id)).toEqual([{ run_state: "idle" }]),
			{ timeout: 5000 },
		);
		expect(textOf(subscribed.messages)).toBe(blocks.join(""));
		expect(query(state.dbPath, "select type from events where session_id = ? and type like 'reply%'", id)).toEqual([]);
		expect(
			query(state.dbPath, "select seq from events where session_id = ? and data like '%UNSTORED-FRAGMENT%'", id),
		).toEqual([]);
		expect(
			query<{ role: string; preview: string }>(
				state.dbPath,
				"select role, preview from messages where session_id = ? order by at, rowid",
				id,
			),
		).toEqual([
			{ role: "user", preview: "Go." },
			{ role: "assistant", preview: "First line." },
		]);
		const end = streamed(subscribed.messages).at(-1)!;
		const entry = await readEntry(id, end.messageEntryId);
		expect(entry.message.content.map((block: { text: string }) => block.text).join("")).toBe(blocks.join(""));
	} finally {
		subscribed.socket.destroy();
		await close(run);
	}
}, 30000);

test("a client that stops reading does not hold up the bridge or other clients; what it missed is coalesced or dropped", async () => {
	// A bridge on the socket sends each delta as its own line, as a slow real stream would.
	const proc = standInProcess();
	const link = await fakeBridge(state.socketPath, "bursty", proc.pid, proc.startedAt);
	const blocks = Array.from({ length: 400 }, (_, i) => `[${i}]${"x".repeat(2000)}`);
	try {
		await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = 'bursty'")).toHaveLength(1));
		const fast = await subscriber(["bursty"]);
		const stalled = await subscriber(["bursty"]);
		stalled.socket.pause();
		blocks.forEach((delta, i) => {
			link.send({ type: "reply_delta", streamId: "s1", seq: i + 1, delta });
		});
		link.send({ type: "reply_end", streamId: "s1", messageEntryId: "e1" });
		// The bridge's link keeps flowing: the runtime answers it while one subscriber reads nothing.
		link.send({ type: "run", run: "idle" });
		link.send({ type: "run", run: "thinking" });
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select run_state from sessions where id = 'bursty'")).toEqual([
				{ run_state: "thinking" },
			]),
		);
		await vi.waitFor(() => expect(streamed(fast.messages).at(-1)?.type).toBe("reply_end"), { timeout: 5000 });
		// A client that reads gets all the text in order, though a burst may arrive coalesced (`seq` skips).
		const fastSeqs = fast.messages.filter((m) => m.type === "reply_delta").map((m) => m.seq);
		expect(fastSeqs).toEqual([...fastSeqs].sort((a, b) => a - b));
		expect(fastSeqs.at(-1)).toBe(blocks.length);
		expect(textOf(fast.messages)).toBe(blocks.join(""));

		// The next reply starts while the stalled client still has not read the first.
		link.send({ type: "reply_delta", streamId: "s2", seq: 1, delta: "Next " });
		link.send({ type: "reply_delta", streamId: "s2", seq: 2, delta: "reply." });
		link.send({ type: "reply_end", streamId: "s2", messageEntryId: "e2" });
		await vi.waitFor(() => expect(streamed(fast.messages).at(-1)?.streamId).toBe("s2"), { timeout: 5000 });

		stalled.socket.resume();
		await vi.waitFor(() => expect(streamed(stalled.messages).at(-1)?.streamId).toBe("s2"), { timeout: 5000 });
		const stream = streamed(stalled.messages);
		// Of the first reply it got what fit in its socket's buffers; the rest was dropped once the next reply started.
		// Only the last end is held, and it ends the first reply too: the client reads that reply from history.
		const first = stream.filter((m) => m.streamId === "s1");
		expect(textOf(first).length).toBeLessThan(blocks.join("").length / 2);
		expect(blocks.join("").startsWith(textOf(first))).toBe(true);
		const seqs = first.filter((m) => m.type === "reply_delta").map((m) => m.seq);
		expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
		expect(first.every((m) => m.type === "reply_delta")).toBe(true);
		// The newest reply arrives whole, coalesced.
		const second = stream.filter((m) => m.streamId === "s2");
		expect(textOf(second)).toBe("Next reply.");
		expect(second.at(-1)).toEqual({ type: "reply_end", sessionId: "bursty", streamId: "s2", messageEntryId: "e2" });
		fast.socket.destroy();
		stalled.socket.destroy();
	} finally {
		link.socket.destroy();
		proc.child.kill();
	}
}, 30000);

test("a paused program caller receives bounded progress and one final result, with no result copy in events", async () => {
	const proc = standInProcess();
	const link = await fakeBridge(state.socketPath, "bursty-turn", proc.pid, proc.startedAt);
	const caller = await client();
	try {
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select id from sessions where id = 'bursty-turn'")).toHaveLength(1),
		);
		caller.send({
			type: "command",
			commandId: "turn-burst",
			sessionId: "bursty-turn",
			command: { kind: "run_turn", task: "work" },
		});
		await vi.waitFor(() =>
			expect(caller.messages).toContainEqual({ type: "receipt", commandId: "turn-burst", stage: "accepted" }),
		);
		caller.socket.pause();
		for (let i = 0; i < 400; i++)
			link.send({
				type: "turn_progress",
				commandId: "turn-burst",
				progress: { activity: `${i}:${"x".repeat(2000)}`, children: [] },
			});
		const result = { status: "completed", text: "PROGRAM_REPLY_NOT_EVENT", operations: [], changes: [] };
		link.send({ type: "command_progress", commandId: "turn-burst", stage: "applied", result });
		link.send({ type: "run", run: "thinking" });
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select run_state from sessions where id = 'bursty-turn'")).toEqual([
				{ run_state: "thinking" },
			]),
		);
		caller.socket.resume();
		await vi.waitFor(
			() =>
				expect(caller.messages.at(-1)).toEqual({ type: "receipt", commandId: "turn-burst", stage: "applied", result }),
			{ timeout: 5000 },
		);
		expect(caller.messages.filter((message) => message.type === "turn_progress").length).toBeLessThan(200);
		expect(query(state.dbPath, "select seq from events where data like '%PROGRAM_REPLY_NOT_EVENT%'")).toEqual([]);
	} finally {
		caller.socket.destroy();
		link.socket.destroy();
		proc.child.kill();
	}
}, 30000);
