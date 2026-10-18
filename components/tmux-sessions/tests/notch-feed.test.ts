import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { migrate } from "../../session-state/src/schema.js";
import { query, sendCommand, startRuntime, stopRuntime, tempStateDir } from "../../session-state/tests/helpers.js";

const source = fileURLToPath(new URL("../notch/NotchShell.swift", import.meta.url));
const hasSwiftc = process.platform === "darwin" && spawnSync("/bin/sh", ["-c", "command -v swiftc"]).status === 0;

const scratch = mkdtempSync(join(tmpdir(), "pi-notch-feed-"));
const binary = join(scratch, "pi-notch");
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// Built as notch.sh builds it; never launched as a panel, only with --feed-once.
beforeAll(() => {
	if (!hasSwiftc) return;
	const result = spawnSync("swiftc", ["-O", source, "-o", binary], { encoding: "utf8" });
	expect(result.status, result.stderr).toBe(0);
}, 300_000);

/** A state database with the live sessions below, plus sessions the notch must leave out. */
function fixture(agentDir: string) {
	mkdirSync(join(agentDir, "state"), { recursive: true });
	const bundle = join(agentDir, "ledger", "202601010000-fix");
	mkdirSync(bundle, { recursive: true });
	writeFileSync(join(bundle, "task.md"), "Intro\n# Fix the parser\n\nStatus: ready\n");
	const db = new DatabaseSync(join(agentDir, "state", "apple-pi.db"));
	// As the runtime keeps it; closing removes the -shm file, as a stopped runtime leaves it.
	db.exec("pragma journal_mode = wal");
	migrate(db);
	const session = db.prepare(
		`insert into sessions (id, kind, cwd, name, run_state, generation, source, updated_at, prompt, needs_you_since,
			current_tool, current_tool_arg, current_task) values (?, ?, ?, ?, ?, ?, 'bridge', ?, ?, ?, ?, ?, ?)`,
	);
	const incarnation = db.prepare(
		`insert into incarnations (session_id, generation, pid, process_started_at, process_state, started_at, ended_at,
			source, updated_at, tmux_socket, pane_id) values (?, ?, 1, 0, ?, 0, ?, 'bridge', 0, '/tmp/tmux-1/default', ?)`,
	);
	const task = JSON.stringify({ bundle, taskId: "202601010000-fix" });
	session.run("ask", "root", "/work/alpha", "Asker", "thinking", 1, 9000, '{"kind":"select"}', 8000, null, null, null);
	incarnation.run("ask", 1, "alive", null, "%1");
	session.run("done", "root", "/work/beta", null, "idle", 1, 3000, null, 3000, null, null, task);
	incarnation.run("done", 1, "alive_bridge_lost", null, "%2");
	session.run("work", "root", "/work/gamma", null, "running_tool", 1, 5000, null, null, "read", "/x.ts", null);
	incarnation.run("work", 1, "alive", null, "%3");
	session.run("quiet", "root", "/work/delta", "Idle one", "idle", 1, 7000, null, null, null, null, null);
	incarnation.run("quiet", 1, "alive", null, "%9");
	// Left out: a subagent, an ended session, a session outside tmux, and one whose current generation has not started.
	session.run("child", "child", "/work/alpha", null, "thinking", 1, 1000, null, null, null, null, null);
	incarnation.run("child", 1, "alive", null, "%1");
	session.run("gone", "root", "/work/alpha", null, "idle", 1, 1000, null, null, null, null, null);
	incarnation.run("gone", 1, "exited", 2000, "%5");
	session.run("bare", "root", "/work/alpha", null, "idle", 1, 1000, null, null, null, null, null);
	incarnation.run("bare", 1, "alive", null, null);
	session.run("reopen", "root", "/work/alpha", null, "idle", 2, 1000, null, null, null, null, null);
	incarnation.run("reopen", 1, "alive", null, "%6");
	const event = db.prepare(
		"insert into events (at, source, session_id, generation, type, data) values (0, 'bridge', ?, 1, 'tool_started', ?)",
	);
	event.run("done", JSON.stringify({ id: "t1", name: "bash", arg: "ls" }));
	event.run("done", JSON.stringify({ id: "t2", name: "edit", arg: "src/a.ts" }));
	event.run("work", JSON.stringify({ id: "t3", name: "grep", arg: "x" }));
	const tmux = (sql: string, ...values: (string | number)[]) =>
		db.prepare(sql).run("/tmp/tmux-1/default", ...values, "tmux", 0);
	tmux("insert into tmux_sessions (socket, id, name, source, updated_at) values (?, ?, ?, ?, ?)", "$1", "main");
	tmux("insert into tmux_sessions (socket, id, name, source, updated_at) values (?, ?, ?, ?, ?)", "$2", "side");
	for (const [link, window, sessionId] of [
		["l1", "@1", "$1"],
		["l2", "@2", "$2"],
	])
		tmux(
			`insert into tmux_window_links (socket, id, session_id, window_id, window_index, source, updated_at)
			values (?, ?, ?, ?, 0, ?, ?)`,
			link,
			sessionId,
			window,
		);
	for (const [pane, window] of [
		["%1", "@1"],
		["%2", "@1"],
		["%3", "@2"],
	])
		tmux(
			`insert into tmux_panes (socket, id, window_id, tty, pid, current_command, current_path, active, dead, source, updated_at)
			values (?, ?, ?, '/dev/ttys001', 1, 'node', '/', 1, 0, ?, ?)`,
			pane,
			window,
		);
	db.close();
}

test.skipIf(!hasSwiftc)(
	"--feed-once prints the live top-level agents from the database, those that need you first",
	() => {
		const agentDir = join(scratch, "feed");
		fixture(agentDir);
		const result = spawnSync(binary, ["--feed-once"], {
			env: { ...process.env, PI_CODING_AGENT_DIR: agentDir },
			encoding: "utf8",
		});
		expect(result.status, result.stderr).toBe(0);
		const socket = "/tmp/tmux-1/default";
		expect(JSON.parse(result.stdout)).toEqual([
			{
				...{ id: "done", name: "Fix the parser", project: "beta", state: "done", tool: "edit", detail: "src/a.ts" },
				...{ tmuxSession: "main", paneId: "%2", tmuxSocket: socket, updatedAt: 3 },
			},
			{
				...{ id: "ask", name: "Asker", project: "alpha", state: "waiting", tool: "", detail: "" },
				...{ tmuxSession: "main", paneId: "%1", tmuxSocket: socket, updatedAt: 9 },
			},
			{
				...{ id: "work", name: "gamma", project: "gamma", state: "working", tool: "read", detail: "/x.ts" },
				...{ tmuxSession: "side", paneId: "%3", tmuxSocket: socket, updatedAt: 5 },
			},
			{
				...{ id: "quiet", name: "Idle one", project: "delta", state: "quiet", tool: "", detail: "" },
				...{ tmuxSession: "", paneId: "%9", tmuxSocket: socket, updatedAt: 7 },
			},
		]);
	},
);

test.skipIf(!hasSwiftc)("--feed-once prints no agents before the database exists", () => {
	const result = spawnSync(binary, ["--feed-once"], {
		env: { ...process.env, PI_CODING_AGENT_DIR: join(scratch, "empty") },
		encoding: "utf8",
	});
	expect(result.status, result.stderr).toBe(0);
	expect(result.stdout.trim()).toBe("[]");
});

test("the notch's choices, sent as the panel sends them, stay in the database after the runtime stops", async () => {
	const state = tempStateDir();
	try {
		const choices = { vibes: { main: "cozy" }, rooms: {}, looks: {}, positions: { "s-1": { x: 0.25, y: 0.5 } } };
		await startRuntime(state.socketPath);
		expect(
			await sendCommand(state.socketPath, "notch", { kind: "set_preference", key: "notch", value: choices }),
		).toEqual([{ stage: "accepted" }, { stage: "applied" }]);
		const runtime = Number(readFileSync(state.pidPath, "utf8"));
		process.kill(runtime, "SIGTERM");
		await vi.waitFor(() => expect(() => process.kill(runtime, 0)).toThrow(), { timeout: 5000 });
		const [row] = query<{ value: string }>(state.dbPath, "select value from preferences where key = 'notch'");
		expect(JSON.parse(row.value)).toEqual(choices);
	} finally {
		await stopRuntime(state);
	}
});
