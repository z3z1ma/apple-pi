import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fakeBridge, query, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const dir = mkdtempSync(join(tmpdir(), "aps-history-"));
const proc = standInProcess();
beforeAll(() => startRuntime(state.socketPath));
afterAll(async () => {
	proc.child.kill();
	await stopRuntime(state);
	rmSync(dir, { recursive: true, force: true });
});

function transcript(count: number) {
	const start = Date.parse("2026-01-01T00:00:00Z");
	const entries = [{ type: "session", id: "header", timestamp: new Date(start).toISOString() }];
	const rows = [];
	for (let i = 0; i < count; i++) {
		const role = i % 2 ? "assistant" : "user";
		const at = start + i * 1000;
		entries.push({
			type: "message",
			id: `e${i}`,
			timestamp: new Date(at).toISOString(),
			message: { role, content: [{ type: "text", text: `message ${i}` }] },
		} as never);
		rows.push({ entryId: `e${i}`, part: "", at, role, size: 10, preview: `message ${i}` });
	}
	return { entries, rows, text: `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n` };
}

async function indexedSession(id: string, file: string, rows: unknown[]) {
	const bridge = await fakeBridge(state.socketPath, id, proc.pid, proc.startedAt, { session: { file } });
	bridge.send({ type: "index", rows });
	await vi.waitFor(
		() =>
			expect(query(state.dbPath, "select count(*) as n from messages where session_id = ?", id)).toEqual([
				{ n: rows.length },
			]),
		{ timeout: 10000 },
	);
	return bridge;
}

async function readEntries(request: Record<string, unknown>, waitMs = 3000): Promise<Record<string, any>> {
	const socket = createConnection(state.socketPath);
	await new Promise((resolve) => socket.once("connect", resolve));
	const reply = new Promise<string>((resolve) => {
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk.toString();
			if (buffer.includes("\n")) resolve(buffer.slice(0, buffer.indexOf("\n")));
		});
	});
	socket.write(`${JSON.stringify({ type: "read_entries", requestId: "p1", ...request })}\n`);
	const line = await Promise.race([
		reply,
		new Promise<string>((resolve) => setTimeout(() => resolve('{"timedOut":true}'), waitMs)),
	]);
	socket.destroy();
	return JSON.parse(line);
}

test("paging back through a long transcript returns every entry once, in order", async () => {
	const { entries, rows, text } = transcript(3000);
	const file = join(dir, "long.jsonl");
	writeFileSync(file, text);
	const bridge = await indexedSession("long", file, rows);
	try {
		const seen: unknown[] = [];
		let before: string | null | undefined;
		let pages = 0;
		do {
			const page = await readEntries({ sessionId: "long", limit: 250, ...(before ? { before } : {}) }, 20000);
			pages++;
			expect(page.entries).toHaveLength(250);
			seen.unshift(...page.entries);
			before = page.before;
		} while (before);
		expect(pages).toBe(12);
		expect(seen).toEqual(entries.slice(1));
	} finally {
		bridge.socket.destroy();
	}
}, 60000);

test("a page holds the newest entries in transcript order, with a cursor to the page before", async () => {
	const { entries, rows, text } = transcript(5);
	const file = join(dir, "five.jsonl");
	writeFileSync(file, text);
	const bridge = await indexedSession("five", file, rows);
	try {
		const newest = await readEntries({ sessionId: "five", limit: 2 });
		expect(newest).toEqual({ type: "entries", requestId: "p1", entries: entries.slice(4, 6), before: "e3" });
		const middle = await readEntries({ sessionId: "five", limit: 2, before: "e3" });
		expect(middle).toEqual({ type: "entries", requestId: "p1", entries: entries.slice(2, 4), before: "e1" });
		const first = await readEntries({ sessionId: "five", limit: 2, before: "e1" });
		expect(first).toEqual({ type: "entries", requestId: "p1", entries: entries.slice(1, 2), before: null });
	} finally {
		bridge.socket.destroy();
	}
}, 20000);

test("a text-only page skips tool work and mail, paging only written words", async () => {
	const { entries, rows, text } = transcript(6);
	const indexed = rows.map((row, i) =>
		i === 1 ? { ...row, size: 0 } : i === 2 ? { ...row, role: "custom", tool: "apple-pi.mailbox-message" } : row,
	);
	const file = join(dir, "words.jsonl");
	writeFileSync(file, text);
	const bridge = await indexedSession("words", file, indexed);
	try {
		const newest = await readEntries({ sessionId: "words", limit: 3, textOnly: true });
		expect(newest).toEqual({ type: "entries", requestId: "p1", entries: entries.slice(4, 7), before: "e3" });
		const older = await readEntries({ sessionId: "words", limit: 3, before: "e3", textOnly: true });
		expect(older).toEqual({ type: "entries", requestId: "p1", entries: [entries[1]], before: null });
		const everything = await readEntries({ sessionId: "words", limit: 3, before: "e3" });
		expect(everything.entries).toEqual(entries.slice(1, 4));
	} finally {
		bridge.socket.destroy();
	}
}, 20000);

test("a text-only page keeps a wordless entry that opened a browser page, and still skips other tool work", async () => {
	const { entries, rows, text } = transcript(4);
	const indexed = [
		...rows.map((row, i) => (i === 1 || i === 3 ? { ...row, size: 0 } : row)),
		{
			entryId: "e1",
			part: "call-page",
			at: rows[1]!.at,
			role: "tool_call",
			tool: "sign_off_code",
			size: 40,
			preview: "",
		},
		{ entryId: "e3", part: "call-read", at: rows[3]!.at, role: "tool_call", tool: "read", size: 40, preview: "" },
	];
	const file = join(dir, "pages.jsonl");
	writeFileSync(file, text);
	const bridge = await indexedSession("pages", file, indexed);
	try {
		const page = await readEntries({ sessionId: "pages", limit: 10, textOnly: true });
		expect(page.entries.map((entry: { id: string }) => entry.id)).toEqual(["e0", "e1", "e2"]);
	} finally {
		bridge.socket.destroy();
	}
}, 20000);

test("a page names indexed entries the transcript no longer holds, and bad requests answer with an error", async () => {
	const { entries, rows, text } = transcript(3);
	const file = join(dir, "gone.jsonl");
	writeFileSync(file, text.replace(`${JSON.stringify(entries[2])}\n`, ""));
	const bridge = await indexedSession("gone", file, rows);
	try {
		expect(await readEntries({ sessionId: "gone" })).toEqual({
			type: "entries",
			requestId: "p1",
			entries: [entries[1], entries[3]],
			before: null,
			missing: ["e1"],
		});
		expect(await readEntries({ sessionId: "gone", before: "nope" })).toEqual({
			type: "entries",
			requestId: "p1",
			error: "unknown cursor",
		});
		expect(await readEntries({ sessionId: "nobody" })).toEqual({
			type: "entries",
			requestId: "p1",
			error: "unknown session",
		});
	} finally {
		bridge.socket.destroy();
	}
}, 20000);
