import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { countIndex, indexTranscript, openIndex, searchIndex } from "../src/transcript-index.js";
import { fakeBridge, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const dir = mkdtempSync(join(tmpdir(), "transcript-index-"));
const state = tempStateDir();
const proc = standInProcess();
beforeAll(() => startRuntime(state.socketPath));
afterAll(async () => {
	proc.child.kill();
	await stopRuntime(state);
	rmSync(dir, { recursive: true, force: true });
});

const T = Date.parse("2026-11-01T00:00:00Z");
const line = (entry: object) => `${JSON.stringify(entry)}\n`;
const user = (id: string, i: number, text: string) =>
	line({
		type: "message",
		id,
		parentId: null,
		timestamp: new Date(T + i).toISOString(),
		message: { role: "user", content: text },
	});
const assistant = (id: string, i: number, text: string, call?: { name: string; arguments: object }) =>
	line({
		type: "message",
		id,
		parentId: null,
		timestamp: new Date(T + i).toISOString(),
		message: {
			role: "assistant",
			content: [
				{ type: "text", text },
				...(call ? [{ type: "toolCall", id: `c-${id}`, name: call.name, arguments: call.arguments }] : []),
			],
		},
	});
const result = (id: string, i: number, text: string) =>
	line({
		type: "message",
		id,
		parentId: null,
		timestamp: new Date(T + i).toISOString(),
		message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text }] },
	});

test("an index follows a transcript as it grows and when it is replaced, and searches words or everything", async () => {
	const file = join(dir, "grow.jsonl");
	writeFileSync(
		file,
		user("u1", 1, "Why do the pelican builds fail?") +
			assistant("a1", 2, "Checking the build log.", { name: "bash", arguments: { command: "npm run build" } }) +
			result("r1", 3, "error: pelican module missing"),
	);
	const db = openIndex(join(dir, "grow.db"));
	await indexTranscript(db, "s1", file);
	const ids = (query: string, fields: "words" | "all" = "all") =>
		searchIndex(db, { query, fields }).map((hit) => hit.entry);
	expect(ids("pelican").sort()).toEqual(["r1", "u1"]);
	expect(ids("pelican", "words")).toEqual(["u1"]);
	expect(ids("npm build")[0]).toBe("a1");
	expect(ids("pelican missing")).toEqual(["r1", "u1"]);

	appendFileSync(file, assistant("a2", 4, "The pelican module was renamed to heron."));
	await indexTranscript(db, "s1", file);
	expect(ids("heron")).toEqual(["a2"]);

	rmSync(file);
	writeFileSync(file, user("u9", 9, "A fresh start about herons."));
	await indexTranscript(db, "s1", file);
	expect(ids("pelican")).toEqual([]);
	expect(ids("herons")).toEqual(["u9"]);
	db.close();
});

test("hits carry #N ordinals counted as load-messages counts them, and eligibility applies before paging", async () => {
	const file = join(dir, "ordinal.jsonl");
	writeFileSync(
		file,
		user("m0", 1, "heron one") +
			line({
				type: "message",
				id: "m1",
				parentId: null,
				timestamp: new Date(T + 2).toISOString(),
				message: { role: "assistant", content: [] },
			}) +
			line({
				type: "custom_message",
				customType: "mail",
				content: "heron mail",
				id: "c0",
				parentId: null,
				timestamp: new Date(T + 3).toISOString(),
			}) +
			user("m2", 4, "heron two") +
			user("m3", 5, "heron three"),
	);
	const db = openIndex(join(dir, "ordinal.db"));
	await indexTranscript(db, "s2", file);
	const all = searchIndex(db, { query: "heron", limit: 10 });
	expect(Object.fromEntries(all.map((hit) => [hit.entry, hit.ordinal]))).toEqual({ m0: 0, c0: null, m2: 2, m3: 3 });
	const text = readFileSync(file);
	for (const hit of all)
		expect(JSON.parse(text.subarray(hit.offset, hit.offset + hit.length).toString()).id).toBe(hit.entry);
	expect(searchIndex(db, { query: "heron", sessions: ["elsewhere"] })).toEqual([]);
	expect(searchIndex(db, { query: "heron", sessions: ["s2"] })).toHaveLength(4);
	const rest = { query: "heron", exclude: [{ session: "s2", entries: ["m3", "c0"] }] };
	expect(countIndex(db, rest)).toBe(2);
	const first = searchIndex(db, { ...rest, limit: 1 });
	const second = searchIndex(db, { ...rest, limit: 1, offset: 1 });
	expect([...first, ...second].map((hit) => hit.entry).sort()).toEqual(["m0", "m2"]);
	db.close();
});

test("only the records search_session shows are indexed, and earlier recall results rank behind original evidence", async () => {
	const file = join(dir, "sources.jsonl");
	const at = (i: number) => new Date(T + i).toISOString();
	writeFileSync(
		file,
		line({
			type: "custom",
			customType: "extension.state",
			data: { secret: "needle" },
			id: "x",
			parentId: null,
			timestamp: at(1),
		}) +
			line({
				type: "custom",
				customType: "notebook.reflections.recorded",
				data: { reflections: [{ id: "n1", content: "the needle lives in the barn" }] },
				id: "nb",
				parentId: null,
				timestamp: at(2),
			}) +
			user("orig", 3, "needle: retain owner") +
			line({
				type: "message",
				id: "echo",
				parentId: null,
				timestamp: at(4),
				message: {
					role: "toolResult",
					toolName: "search_session",
					content: [{ type: "text", text: "needle needle needle" }],
				},
			}),
	);
	const db = openIndex(join(dir, "sources.db"));
	await indexTranscript(db, "s3", file);
	const hits = searchIndex(db, { query: "needle" }).map((hit) => hit.entry);
	expect(hits).not.toContain("x");
	expect(hits.at(-1)).toBe("echo");
	expect(hits.slice(0, -1).sort()).toEqual(["nb", "orig"]);
	db.close();
});

test("the runtime indexes a session's transcript and answers searches over its socket", async () => {
	const file = join(dir, "live.jsonl");
	writeFileSync(file, user("e1", 1, "Remember the albatross migration plan."));
	const bridge = await fakeBridge(state.socketPath, "live", proc.pid, proc.startedAt, { session: { file } });
	try {
		bridge.send({
			type: "index",
			rows: [{ entryId: "e1", part: "", at: T + 1, role: "user", size: 37, preview: "Remember the albatross" }],
		});
		const search = async (query: string) => {
			const socket = createConnection(state.socketPath);
			await new Promise((resolve) => socket.once("connect", resolve));
			const reply = new Promise<Record<string, any>>((resolve) => {
				let buffer = "";
				socket.on("data", (chunk) => {
					buffer += chunk.toString();
					if (buffer.includes("\n")) resolve(JSON.parse(buffer.slice(0, buffer.indexOf("\n"))));
				});
			});
			socket.write(`${JSON.stringify({ type: "search_transcripts", requestId: "q", query, sessions: ["live"] })}\n`);
			const answer = await reply;
			socket.destroy();
			return answer;
		};
		await vi.waitFor(
			async () => expect((await search("albatross")).hits?.map((hit: any) => hit.entry)).toEqual(["e1"]),
			{
				timeout: 10_000,
			},
		);
		appendFileSync(file, assistant("e2", 2, "The albatross plan moved to Thursday."));
		bridge.send({
			type: "index",
			rows: [{ entryId: "e2", part: "", at: T + 2, role: "assistant", size: 38, preview: "The" }],
		});
		await vi.waitFor(
			async () => expect((await search("Thursday")).hits?.map((hit: any) => hit.entry)).toEqual(["e2"]),
			{
				timeout: 10_000,
			},
		);
		const both = await search("albatross");
		expect(both.total).toBe(2);
		expect(both.hits.map((hit: any) => [hit.entry, hit.ordinal, hit.file])).toEqual(
			expect.arrayContaining([
				["e1", 0, file],
				["e2", 1, file],
			]),
		);
	} finally {
		bridge.socket.destroy();
	}
}, 30_000);
