import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterAll, expect, test, vi } from "vitest";
import installLedger from "../../../extensions/ledger.js";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { close, query, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
const dirs: string[] = [];
const tempDir = (prefix: string) => {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
};
afterAll(async () => {
	await stopRuntime(state);
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

type Row = Record<string, unknown>;
const session = (id: string) => query<Row>(state.dbPath, "select * from sessions where id = ?", id)[0];
const json = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value);
const seen = (id: string) => vi.waitFor(() => expect(session(id)).toBeDefined(), { timeout: 15000 });
const write = (path: string, content: string) =>
	fauxAssistantMessage([fauxToolCall("write", { path, content })], { stopReason: "toolUse" });

test("a session started with --reports-to shows who it reports to", async () => {
	const run = await fauxSession([bridge], [], []);
	try {
		const id = run.session.sessionManager.getSessionId();
		await seen(id);
		run.session.extensionRunner.setFlagValue("reports-to", "coordinator-1");
		await run.session.bindExtensions({}); // a new session_start reads the flag
		await vi.waitFor(() => expect(session(id).reports_to).toBe("coordinator-1"));
		expect(
			query(state.dbPath, "select 1 from events where session_id = ? and type = 'reports_to_changed'", id),
		).toHaveLength(1);
	} finally {
		await close(run);
	}
}, 20000);

test("a forked session names its parent, and a session that followed another in the same process names that one", async () => {
	const cwd = tempDir("aps-rel-");
	const sessionDir = tempDir("aps-rel-sessions-");
	const parentManager = SessionManager.create(cwd, sessionDir);
	const parent = await fauxSession([bridge], [fauxAssistantMessage("hello")], [], {
		cwd,
		sessionManager: parentManager,
	});
	const runs = [parent];
	try {
		await parent.session.prompt("hi"); // writes the file a fork copies
		await seen(parentManager.getSessionId());
		const childManager = SessionManager.forkFrom(parentManager.getSessionFile()!, cwd, sessionDir);
		const child = await fauxSession([bridge], [], [], { cwd, sessionManager: childManager });
		runs.push(child);
		await vi.waitFor(
			() =>
				expect(session(childManager.getSessionId())).toMatchObject({
					parent_session_file: parentManager.getSessionFile(),
					parent_session_id: parentManager.getSessionId(),
				}),
			{ timeout: 15000 },
		);
		// The host switched this process from the parent to the child, as /new or /resume does.
		await child.session.extensionRunner.emit({
			type: "session_start",
			reason: "resume",
			previousSessionFile: parentManager.getSessionFile(),
		});
		await vi.waitFor(() =>
			expect(session(childManager.getSessionId())).toMatchObject({ previous_session_id: parentManager.getSessionId() }),
		);
		expect(json(session(childManager.getSessionId()).previous_session)).toEqual({
			file: parentManager.getSessionFile(),
			reason: "resume",
		});
		// Navigating again from another known session points at that one instead.
		const otherManager = SessionManager.create(cwd, sessionDir);
		const other = await fauxSession([bridge], [fauxAssistantMessage("other")], [], {
			cwd,
			sessionManager: otherManager,
		});
		runs.push(other);
		await other.session.prompt("hi");
		await seen(otherManager.getSessionId());
		await child.session.extensionRunner.emit({
			type: "session_start",
			reason: "new",
			previousSessionFile: otherManager.getSessionFile(),
		});
		await vi.waitFor(() =>
			expect(session(childManager.getSessionId())).toMatchObject({ previous_session_id: otherManager.getSessionId() }),
		);
	} finally {
		for (const run of runs) await close(run);
	}
}, 30000);

test("a session in a git repository shows its repository, worktree, and branch, and a branch switch updates it", async () => {
	const repo = tempDir("aps-repo-");
	const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim();
	git("init", "-q", "-b", "main");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "start");
	const top = git("rev-parse", "--show-toplevel");
	mkdirSync(join(repo, "src", "deep"), { recursive: true });
	const run = await fauxSession(
		[bridge],
		[
			fauxAssistantMessage([fauxToolCall("bash", { command: "git checkout -q -b feature" })], {
				stopReason: "toolUse",
			}),
			fauxAssistantMessage("switched"),
		],
		["bash"],
		{ cwd: join(repo, "src", "deep") }, // below the checkout root: the repository is still the root
	);
	try {
		const id = run.session.sessionManager.getSessionId();
		await vi.waitFor(() => expect(json(session(id)?.git)).toEqual({ repository: top, worktree: top, branch: "main" }), {
			timeout: 15000,
		});
		await run.session.prompt("make a branch");
		await vi.waitFor(() => expect(json(session(id).git)).toMatchObject({ branch: "feature" }));
	} finally {
		await close(run);
	}
}, 20000);

test("each touch of a ledger task is a time-stamped link, and the latest is the session's current task", async () => {
	const cwd = tempDir("aps-ledger-");
	for (const task of ["202610180001-alpha", "202610180002-beta"]) {
		mkdirSync(join(cwd, ".ledger", task), { recursive: true });
		writeFileSync(join(cwd, ".ledger", task, "task.md"), `# ${task}\n`);
	}
	const manager = SessionManager.create(cwd, tempDir("aps-ledger-sessions-"));
	const run = await fauxSession(
		[bridge, installLedger],
		[
			write(".ledger/202610180001-alpha/notes.md", "first"),
			write(".ledger/202610180002-beta/notes.md", "second"),
			fauxAssistantMessage("done"),
		],
		["write"],
		{ cwd, sessionManager: manager },
	);
	try {
		const id = manager.getSessionId();
		await seen(id);
		await run.session.prompt("take notes");
		await vi.waitFor(() =>
			expect(
				query(state.dbPath, "select task_id, via from session_tasks where session_id = ? order by id", id),
			).toEqual([
				{ task_id: "202610180001-alpha", via: "edit" },
				{ task_id: "202610180002-beta", via: "edit" },
			]),
		);
		expect(json(session(id).current_task)).toMatchObject({ taskId: "202610180002-beta" });
		expect(query(state.dbPath, "select 1 from events where session_id = ? and type = 'task_linked'", id)).toHaveLength(
			2,
		);
		// A reload's new bridge does not know the task yet; the recorded one stays current.
		await run.session.bindExtensions({});
		await new Promise((resolve) => setTimeout(resolve, 500));
		expect(json(session(id).current_task)).toMatchObject({ taskId: "202610180002-beta" });
	} finally {
		await close(run);
	}
}, 20000);

test("a session without a transcript file still records its ledger touches", async () => {
	const cwd = tempDir("aps-ledger-mem-");
	mkdirSync(join(cwd, ".ledger", "202610180003-gamma"), { recursive: true });
	writeFileSync(join(cwd, ".ledger", "202610180003-gamma", "task.md"), "# gamma\n");
	const run = await fauxSession(
		[bridge, installLedger],
		[write(".ledger/202610180003-gamma/notes.md", "note"), fauxAssistantMessage("done")],
		["write"],
		{ cwd },
	);
	try {
		const id = run.session.sessionManager.getSessionId();
		await seen(id);
		await run.session.prompt("note it");
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select task_id from session_tasks where session_id = ?", id)).toEqual([
				{ task_id: "202610180003-gamma" },
			]),
		);
	} finally {
		await close(run);
	}
}, 20000);
