import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { close, query, sendCommand, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const dirs: string[] = [];
beforeAll(() => startRuntime(state.socketPath));
afterAll(async () => {
	await stopRuntime(state);
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const seen = (id: string) =>
	vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = ?", id)).toHaveLength(1), {
		timeout: 15000,
	});
const row = (id: string) => query<Record<string, unknown>>(state.dbPath, "select * from sessions where id = ?", id)[0];

test("talking to an idle session starts a turn, with accepted, delivered, and applied receipts recorded as events", async () => {
	const run = await fauxSession([bridge], [fauxAssistantMessage("hello back")], []);
	try {
		const id = run.session.sessionManager.getSessionId();
		await seen(id);
		expect(await sendCommand(state.socketPath, id, { kind: "talk", text: "hello from a view" })).toEqual([
			{ stage: "accepted" },
			{ stage: "delivered" },
			{ stage: "applied" },
		]);
		await vi.waitFor(() => expect(run.session.messages.at(-1)).toMatchObject({ role: "assistant" }));
		expect(
			run.session.messages.some((m) => m.role === "user" && JSON.stringify(m.content).includes("hello from a view")),
		).toBe(true);
		const types = query<{ type: string }>(
			state.dbPath,
			"select type from events where type like 'command_%' order by seq",
		).map((r) => r.type);
		expect(types).toEqual(["command_accepted", "command_delivered", "command_applied"]);
	} finally {
		await close(run);
	}
}, 20000);

test("talk to a busy session fails; steer, follow-up, and abort reach it", async () => {
	const holds: ((reply: Reply) => void)[] = [];
	const run = await fauxSession(
		[bridge],
		(_context, signal) =>
			signal?.aborted ? fauxAssistantMessage("") : new Promise<Reply>((resolve) => holds.push(resolve)),
		[],
	);
	try {
		const id = run.session.sessionManager.getSessionId();
		await seen(id);
		const turn = run.session.prompt("work");
		await vi.waitFor(() => expect(holds).toHaveLength(1));
		expect((await sendCommand(state.socketPath, id, { kind: "talk", text: "hi" })).at(-1)).toMatchObject({
			stage: "failed",
			reason: expect.stringContaining("busy"),
		});
		expect((await sendCommand(state.socketPath, id, { kind: "steer", text: "go left" })).at(-1)).toEqual({
			stage: "applied",
		});
		expect((await sendCommand(state.socketPath, id, { kind: "follow_up", text: "then tidy" })).at(-1)).toEqual({
			stage: "applied",
		});
		await vi.waitFor(() => expect(JSON.parse(row(id).queue as string)).toMatchObject({ steers: 1, followUps: 1 }));
		// abort is applied only once the run has stopped
		const aborting = sendCommand(state.socketPath, id, { kind: "abort" });
		await vi.waitFor(() => expect(run.session.isStreaming).toBe(true));
		await run.session.abort(); // the faux model holds its reply; the command's abort and this one end the run alike
		expect((await aborting).at(-1)).toEqual({ stage: "applied" });
		await turn.catch(() => {});
	} finally {
		await close(run);
	}
}, 20000);

test("rename and thinking-level commands change the session", async () => {
	const run = await fauxSession([bridge], [], []);
	try {
		const id = run.session.sessionManager.getSessionId();
		await seen(id);
		expect((await sendCommand(state.socketPath, id, { kind: "rename", name: "From a view" })).at(-1)).toEqual({
			stage: "applied",
		});
		await vi.waitFor(() => expect(JSON.parse(row(id).config as string)).toMatchObject({ name: "From a view" }));
		expect(row(id).name).toBe("From a view");
		expect((await sendCommand(state.socketPath, id, { kind: "set_thinking", level: "off" })).at(-1)).toEqual({
			stage: "applied",
		});
		// The faux registry knows one model, which it returns for any name.
		expect(
			(
				await sendCommand(state.socketPath, id, {
					kind: "set_model",
					provider: "faux-session-provider",
					id: "faux-session-model",
				})
			).at(-1),
		).toEqual({ stage: "applied" });
	} finally {
		await close(run);
	}
}, 20000);

test("a repeated command id applies once", async () => {
	const run = await fauxSession([bridge], [fauxAssistantMessage("one"), fauxAssistantMessage("two")], []);
	try {
		const id = run.session.sessionManager.getSessionId();
		await seen(id);
		await sendCommand(state.socketPath, id, { kind: "talk", text: "only once" }, { commandId: "same-id" });
		await vi.waitFor(() => expect(run.session.messages.filter((m) => m.role === "assistant")).toHaveLength(1));
		expect(
			await sendCommand(state.socketPath, id, { kind: "talk", text: "only once" }, { commandId: "same-id" }),
		).toEqual([{ stage: "applied" }]);
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(run.session.messages.filter((m) => m.role === "user")).toHaveLength(1);
	} finally {
		await close(run);
	}
}, 20000);

test("a session that is not running fails at once, and a command bound to an old incarnation never reaches a new one", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "aps-cmd-"));
	const sessionDir = mkdtempSync(join(tmpdir(), "aps-cmd-sessions-"));
	dirs.push(cwd, sessionDir);
	const manager = SessionManager.create(cwd, sessionDir);
	const first = await fauxSession([bridge], [fauxAssistantMessage("hi")], [], { cwd, sessionManager: manager });
	const id = manager.getSessionId();
	try {
		await seen(id);
		await first.session.prompt("hi");
	} finally {
		await close(first);
	}
	expect(await sendCommand(state.socketPath, id, { kind: "talk", text: "anyone?" })).toEqual([
		{ stage: "accepted" },
		{ stage: "failed", reason: "not running" },
	]);
	const second = await fauxSession([bridge], [], [], {
		cwd,
		sessionManager: SessionManager.open(manager.getSessionFile()!),
	});
	try {
		await vi.waitFor(() => expect(row(id).generation).toBe(2));
		expect(
			(await sendCommand(state.socketPath, id, { kind: "rename", name: "stale" }, { generation: 1 })).at(-1),
		).toEqual({
			stage: "failed",
			reason: "not running",
		});
		expect(JSON.parse(row(id).config as string).name).not.toBe("stale");
	} finally {
		await close(second);
	}
}, 30000);
