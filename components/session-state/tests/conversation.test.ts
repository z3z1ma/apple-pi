import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { type ExtensionAPI, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { close, query, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const cwd = mkdtempSync(join(tmpdir(), "aps-conv-"));
const sessionDir = mkdtempSync(join(tmpdir(), "aps-conv-sessions-"));
afterAll(async () => {
	await stopRuntime(state);
	rmSync(cwd, { recursive: true, force: true });
	rmSync(sessionDir, { recursive: true, force: true });
});

/** Ask the runtime for one entry over its socket, as any view would. */
async function readEntry(sessionId: string, entryId: string): Promise<Record<string, unknown>> {
	const socket = createConnection(state.socketPath);
	await new Promise((resolve) => socket.once("connect", resolve));
	const reply = new Promise<string>((resolve) => {
		let buffer = "";
		socket.on("data", (chunk) => {
			buffer += chunk.toString();
			if (buffer.includes("\n")) resolve(buffer.slice(0, buffer.indexOf("\n")));
		});
	});
	socket.write(`${JSON.stringify({ type: "read_entry", requestId: "r1", sessionId, entryId })}\n`);
	const line = await reply;
	socket.destroy();
	return JSON.parse(line);
}

const longReply = `The value is 1. ${"It comes from app.ts and nowhere else. ".repeat(10)}`;

test("completed messages, tool calls, and tool results are indexed, and an entry reads back exactly as in the JSONL", async () => {
	const manager = SessionManager.create(cwd, sessionDir);
	const run = await fauxSession(
		[bridge],
		[
			fauxAssistantMessage([fauxToolCall("read", { path: "app.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage(longReply),
		],
		["read"],
		{ cwd, sessionManager: manager },
	);
	try {
		const id = manager.getSessionId();
		await run.session.prompt("What is the value?");
		await vi.waitFor(
			() =>
				expect(
					query<{ role: string }>(
						state.dbPath,
						"select role from messages where session_id = ? order by at, rowid",
						id,
					).map((row) => row.role),
				).toEqual(["user", "assistant", "tool_call", "tool_result", "assistant"]),
			{ timeout: 15000 },
		);
		const rows = query<Record<string, unknown>>(
			state.dbPath,
			"select * from messages where session_id = ? order by at, rowid",
			id,
		);
		for (const row of rows) {
			expect(row.entry_id).toEqual(expect.any(String));
			expect(row.at).toBeGreaterThan(0);
			expect(row.observed_at).toBeGreaterThanOrEqual(row.at as number);
			expect(row.size).toEqual(expect.any(Number));
		}
		expect(rows.find((row) => row.role === "tool_call")).toMatchObject({ tool: "read", preview: "app.ts" });
		const final = rows.filter((row) => row.role === "assistant").at(-1)!;
		expect(final.size).toBe(longReply.length);
		expect((final.preview as string).length).toBeLessThan(longReply.length); // a preview, not the text

		const lines = readFileSync(manager.getSessionFile()!, "utf8")
			.trim()
			.split("\n")
			.map((line) => JSON.parse(line));
		const fromFile = lines.find((entry) => entry.id === final.entry_id);
		expect(await readEntry(id, final.entry_id as string)).toEqual({ type: "entry", requestId: "r1", entry: fromFile });
		expect(query(state.dbPath, "select type from events where session_id = ? and type = 'message'", id)).toHaveLength(
			5,
		);
	} finally {
		await close(run);
	}
}, 20000);

test("reading an unknown entry answers that it was not found", async () => {
	const [session] = query<{ id: string }>(
		state.dbPath,
		"select id from sessions where session_file is not null limit 1",
	);
	expect(await readEntry(session.id, "no-such-entry")).toEqual({
		type: "entry",
		requestId: "r1",
		error: "entry not found",
	});
	expect(await readEntry("no-such-session", "x")).toEqual({ type: "entry", requestId: "r1", error: "unknown session" });
});

test("a message an extension appends while the session is idle is indexed without another turn", async () => {
	let api: ExtensionAPI | undefined;
	const capture = (pi: ExtensionAPI) => {
		api = pi;
	};
	const run = await fauxSession([bridge, capture], [], []);
	try {
		const id = run.session.sessionManager.getSessionId();
		await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = ?", id)).toHaveLength(1), {
			timeout: 15000,
		});
		api!.sendMessage({ customType: "note", content: "left a note while idle", display: true }, { triggerTurn: false });
		await vi.waitFor(
			() =>
				expect(query(state.dbPath, "select role, tool, preview from messages where session_id = ?", id)).toEqual([
					{ role: "custom", tool: "note", preview: "left a note while idle" },
				]),
			{ timeout: 5000 },
		);
	} finally {
		await close(run);
	}
}, 20000);
