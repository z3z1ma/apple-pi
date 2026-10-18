import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import bridge, { SCHEMA_VERSION } from "../src/index.js";
import { close, query, runtimePid, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
afterAll(() => stopRuntime(state));

type Row = Record<string, unknown>;

test("a session with the bridge starts the runtime and appears alive in the database", async () => {
	const run = await fauxSession([bridge], [], []);
	try {
		const id = run.session.sessionManager.getSessionId();
		await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = ?", id)).toHaveLength(1), {
			timeout: 15000,
		});
		const [incarnation] = query<Row>(state.dbPath, "select * from incarnations where session_id = ?", id);
		expect(incarnation).toMatchObject({ generation: 1, pid: process.pid, process_state: "alive" });
		expect(Math.abs((incarnation.process_started_at as number) - (Date.now() - process.uptime() * 1000))).toBeLessThan(
			2000,
		);
		const [{ user_version }] = query<{ user_version: number }>(state.dbPath, "pragma user_version");
		expect(user_version).toBe(SCHEMA_VERSION);
	} finally {
		await close(run);
	}
}, 20000);

const seen = (id: string) => () =>
	expect(query(state.dbPath, "select id from sessions where id = ?", id)).toHaveLength(1);

test("a second session connects to the running runtime instead of starting another", async () => {
	const first = await fauxSession([bridge], [], []);
	const second = await fauxSession([bridge], [], []);
	try {
		await vi.waitFor(seen(first.session.sessionManager.getSessionId()), { timeout: 15000 });
		const pid = runtimePid(state.pidPath);
		await vi.waitFor(seen(second.session.sessionManager.getSessionId()), { timeout: 15000 });
		expect(runtimePid(state.pidPath)).toBe(pid);
	} finally {
		await close(first);
		await close(second);
	}
}, 20000);

test("a tool-using turn moves the run state through each stage, each change a sourced event", async () => {
	const run = await fauxSession(
		[bridge],
		[
			fauxAssistantMessage([fauxToolCall("read", { path: "app.ts" })], { stopReason: "toolUse" }),
			fauxAssistantMessage("The value is 1."),
		],
		["read"],
		{ streamText: true },
	);
	try {
		const id = run.session.sessionManager.getSessionId();
		await vi.waitFor(seen(id), { timeout: 15000 });
		await run.session.prompt("What is the value?");
		await vi.waitFor(
			() =>
				expect(query(state.dbPath, "select run_state from sessions where id = ?", id)).toEqual([{ run_state: "idle" }]),
			{ timeout: 5000 },
		);
		const changes = query<{ source: string; at: number; data: string }>(
			state.dbPath,
			"select source, at, data from events where session_id = ? and type = 'run_state' order by seq",
			id,
		);
		const states = changes.map((change) => JSON.parse(change.data).to);
		expect(states).toEqual(["thinking", "running_tool", "thinking", "writing_reply", "idle"]);
		for (const change of changes) {
			expect(change.source).toBe("bridge");
			expect(change.at).toBeGreaterThan(0);
		}
	} finally {
		await close(run);
	}
}, 20000);

test("a clean shutdown ends the incarnation as exited, and reopening the session starts generation 2", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "aps-cwd-"));
	const sessionDir = mkdtempSync(join(tmpdir(), "aps-sessions-"));
	const sessions: { session: { extensionRunner: { emit(event: unknown): Promise<unknown> } }; dispose(): void }[] = [];
	try {
		const manager = SessionManager.create(cwd, sessionDir);
		const first = await fauxSession([bridge], [fauxAssistantMessage("hi")], [], { cwd, sessionManager: manager });
		sessions.push(first);
		const id = manager.getSessionId();
		await vi.waitFor(seen(id), { timeout: 15000 });
		await first.session.prompt("hello"); // writes the session file so it can be reopened
		await close(sessions.pop()!);
		await vi.waitFor(
			() =>
				expect(
					query(state.dbPath, "select process_state, end_reason from incarnations where session_id = ?", id),
				).toEqual([{ process_state: "exited", end_reason: "quit" }]),
			{ timeout: 5000 },
		);
		const second = await fauxSession([bridge], [], [], {
			cwd,
			sessionManager: SessionManager.open(manager.getSessionFile()!),
		});
		sessions.push(second);
		await vi.waitFor(
			() =>
				expect(
					query(
						state.dbPath,
						"select generation, process_state from incarnations where session_id = ? order by generation",
						id,
					),
				).toEqual([
					{ generation: 1, process_state: "exited" },
					{ generation: 2, process_state: "alive" },
				]),
			{ timeout: 5000 },
		);
	} finally {
		for (const run of sessions) await close(run);
		rmSync(cwd, { recursive: true, force: true });
		rmSync(sessionDir, { recursive: true, force: true });
	}
}, 20000);

test("a reload keeps the process's incarnation instead of starting a new generation", async () => {
	const run = await fauxSession([bridge], [], []);
	try {
		const id = run.session.sessionManager.getSessionId();
		await vi.waitFor(seen(id), { timeout: 15000 });
		await run.session.bindExtensions({ onError: () => {} }); // reload emits session_start only to a bound host
		await run.session.reload();
		await new Promise((resolve) => setTimeout(resolve, 1500));
		expect(
			query(state.dbPath, "select generation, process_state, ended_at from incarnations where session_id = ?", id),
		).toEqual([{ generation: 1, process_state: "alive", ended_at: null }]);
	} finally {
		await close(run);
	}
}, 20000);

test("a runtime that cannot start is reported to the session", async () => {
	const warnings: string[] = [];
	vi.stubEnv("PI_CODING_AGENT_DIR", "/dev/null/aps");
	const run = await fauxSession([bridge], [], []);
	try {
		await run.session.bindExtensions({
			mode: "tui",
			uiContext: { notify: (message: string) => warnings.push(message) } as never,
		});
		await vi.waitFor(() => expect(warnings).toEqual([expect.stringContaining("Session state")]), { timeout: 5000 });
	} finally {
		await close(run);
		vi.stubEnv("PI_CODING_AGENT_DIR", state.agentDir);
	}
}, 20000);
