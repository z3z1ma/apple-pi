import { mkdirSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { budget, latency } from "../../../tests/helpers/build-budgets.js";
import { migrate } from "../src/schema.js";
import { indexTranscript, openIndex } from "../src/transcript-index.hot.js";
import { startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const SESSIONS = 128;
const PER_SESSION = 1024;
const LARGE_ENTRIES = 32768;
const T = Date.parse("2026-01-01T00:00:00Z");
let largeBytes = 0;

function entry(id: string, at: number, text: string) {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: new Date(at).toISOString(),
		message: { role: "user", content: [{ type: "text", text }] },
	};
}

async function request(body: Record<string, unknown>): Promise<Record<string, any>> {
	const socket = createConnection(state.socketPath);
	try {
		return await new Promise((resolve, reject) => {
			const timeout = setTimeout(() => reject(new Error("budget request timed out")), 10000);
			const finish = (error?: Error, result?: Record<string, any>) => {
				clearTimeout(timeout);
				if (error) reject(error);
				else resolve(result!);
			};
			socket.once("error", finish);
			socket.once("connect", () => socket.write(`${JSON.stringify({ requestId: "budget", ...body })}\n`));
			let buffer = "";
			socket.on("data", (chunk) => {
				buffer += chunk.toString();
				if (!buffer.includes("\n")) return;
				try {
					finish(undefined, JSON.parse(buffer.slice(0, buffer.indexOf("\n"))));
				} catch (error) {
					finish(error as Error);
				}
			});
		});
	} finally {
		socket.destroy();
	}
}

beforeAll(async () => {
	mkdirSync(state.stateDir, { recursive: true });
	const db = new DatabaseSync(state.dbPath);
	migrate(db);
	const session = db.prepare(
		"insert into sessions (id, kind, cwd, session_file, name, run_state, generation, source, updated_at) values (?, 'root', ?, ?, ?, 'idle', 0, 'fixture', ?)",
	);
	const index = openIndex(join(state.stateDir, "transcript-index.db"));
	try {
		for (let s = 0; s < SESSIONS; s++) {
			const id = `search-${s}`;
			const file = join(state.agentDir, `${id}.jsonl`);
			const lines = Array.from({ length: PER_SESSION }, (_, i) =>
				JSON.stringify(
					entry(
						`e${i}`,
						T + i,
						`Migration plan session ${s} step ${i}. ${"Inspect deployment records and confirm rollback. ".repeat(4)}`,
					),
				),
			);
			writeFileSync(file, `${lines.join("\n")}\n`);
			session.run(id, state.agentDir, file, id, T);
			await indexTranscript(index, id, file);
		}
		const file = join(state.agentDir, "large.jsonl");
		const lines = Array.from({ length: LARGE_ENTRIES }, (_, i) =>
			JSON.stringify(entry(`large-${i}`, T + i, `Message ${i}: ${"x".repeat(2048)}`)),
		);
		const text = `${lines.join("\n")}\n`;
		largeBytes = Buffer.byteLength(text);
		writeFileSync(file, text);
		session.run("large", state.agentDir, file, "Large transcript", T);
		await indexTranscript(index, "large", file);
		expect(index.prepare("select count(*) as n from entries").get()).toEqual({
			n: SESSIONS * PER_SESSION + LARGE_ENTRIES,
		});
		const message = db.prepare(
			"insert into messages (session_id, entry_id, part, at, role, size, preview, source, observed_at) values ('large', ?, '', ?, 'user', 2048, 'Message', 'fixture', ?)",
		);
		db.exec("begin");
		for (let i = 0; i < LARGE_ENTRIES; i++) message.run(`large-${i}`, T + i, T);
		db.exec("commit");
	} finally {
		index.close();
		db.close();
	}
	await startRuntime(state.socketPath);
	await vi.waitFor(
		async () => expect((await request({ type: "read_entries", sessionId: "large", limit: 1 })).entries).toHaveLength(1),
		{ timeout: 10000 },
	);
}, 60000);

afterAll(async () => {
	await stopRuntime(state);
	vi.unstubAllEnvs();
});

test("a newest read_entries page stays within its latency budget on a large transcript", async () => {
	const measured = await latency(async () => {
		const page = await request({ type: "read_entries", sessionId: "large", limit: 50 });
		expect(page.error).toBeUndefined();
		expect(page.missing).toBeUndefined();
		expect(page.entries).toHaveLength(50);
		expect(page.entries.map((entry: any) => ({ id: entry.id, content: entry.message.content }))).toEqual(
			Array.from({ length: 50 }, (_, i) => {
				const n = LARGE_ENTRIES - 50 + i;
				return { id: `large-${n}`, content: [{ type: "text", text: `Message ${n}: ${"x".repeat(2048)}` }] };
			}),
		);
		expect(page.before).toBe(`large-${LARGE_ENTRIES - 50}`);
	});
	budget("read_entries p95 ms", measured.p95, 3, { ...measured, entries: LARGE_ENTRIES, bytes: largeBytes, page: 50 });
}, 30000);

test("search_transcripts p95 stays below 50 ms in a multi-session index", async () => {
	const measured = await latency(async () => {
		const result = await request({
			type: "search_transcripts",
			query: "migration plan",
			sessions: ["search-7"],
			limit: 5,
		});
		expect(result.error).toBeUndefined();
		expect(result.total).toBe(PER_SESSION);
		expect(result.hits).toHaveLength(5);
		expect(result.hits.every((hit: any) => hit.session === "search-7" && hit.file && hit.length > 0)).toBe(true);
	});
	budget("search_transcripts p95 ms", measured.p95, 50, {
		...measured,
		sessions: SESSIONS + 1,
		entries: SESSIONS * PER_SESSION + LARGE_ENTRIES,
	});
}, 30000);
