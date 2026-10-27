import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { killPane } from "../src/tmux.js";
import { close, query, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

// tmux puts -L servers under $TMUX_TMPDIR, so the runtime sees only these scratch servers, never the operator's.
const tmuxDir = mkdtempSync(join(tmpdir(), "apt-"));
const state = tempStateDir();
vi.stubEnv("TMUX_TMPDIR", tmuxDir);
const servers = new Set<string>();

function tmux(server: string, ...args: string[]): string {
	servers.add(server);
	return execFileSync("tmux", ["-L", server, "-f", "/dev/null", ...args], { encoding: "utf8" }).trim();
}
// The path tmux was asked for (through macOS's /var alias) and the resolved path the runtime keys servers by.
const rawSocketOf = (server: string) => join(tmuxDir, `tmux-${process.getuid?.()}`, server);
const socketOf = (server: string) => realpathSync(rawSocketOf(server));

beforeAll(async () => {
	tmux("main", "new-session", "-d", "-s", "alpha", "-x", "80", "-y", "24");
	tmux("main", "new-window", "-d", "-t", "alpha");
	tmux("main", "split-window", "-d", "-t", "alpha:0");
	tmux("main", "new-session", "-d", "-s", "beta");
	await startRuntime(state.socketPath);
});

afterAll(async () => {
	for (const server of servers) {
		try {
			execFileSync("tmux", ["-L", server, "kill-server"], { stdio: "ignore" });
		} catch {}
	}
	await stopRuntime(state);
	rmSync(tmuxDir, { recursive: true, force: true });
});

const rows = (sql: string, ...params: string[]) => query(state.dbPath, sql, ...params);

test("every session, window, and pane of a live server is in the database, panes without Pi included", async () => {
	const socket = socketOf("main");
	const panes = tmux("main", "list-panes", "-a", "-F", "#{pane_id} #{pane_tty}").split("\n");
	await vi.waitFor(() => {
		expect(rows("select socket from tmux_servers where socket = ?", socket)).toHaveLength(1);
		expect(rows("select name from tmux_sessions where socket = ? order by name", socket)).toEqual([
			{ name: "alpha" },
			{ name: "beta" },
		]);
		expect(rows("select id from tmux_windows where socket = ?", socket)).toHaveLength(3);
		expect(rows("select id || ' ' || tty as pane from tmux_panes where socket = ? order by id", socket)).toEqual(
			panes.sort().map((pane) => ({ pane })),
		);
	});
});

test("windows and panes created and killed appear and disappear within about a second, each an event", async () => {
	const socket = socketOf("main");
	const window = tmux("main", "new-window", "-d", "-P", "-F", "#{window_id}", "-t", "beta");
	await vi.waitFor(
		() => expect(rows("select id from tmux_windows where socket = ? and id = ?", socket, window)).toHaveLength(1),
		{
			timeout: 3000,
		},
	);
	tmux("main", "kill-window", "-t", window);
	await vi.waitFor(
		() => expect(rows("select id from tmux_windows where socket = ? and id = ?", socket, window)).toHaveLength(0),
		{
			timeout: 3000,
		},
	);
	const kinds = rows(
		"select type from events where type like 'tmux_window_%' and json_extract(data, '$.id') = ? order by seq",
		window,
	).map((row) => row.type);
	expect(kinds).toEqual(["tmux_window_added", "tmux_window_removed"]);
});

test("a stale socket with no running server produces no rows", async () => {
	tmux("stale", "new-session", "-d");
	const pid = Number(tmux("stale", "display-message", "-p", "#{pid}"));
	process.kill(pid, "SIGKILL");
	const socket = socketOf("stale");
	expect(existsSync(socket)).toBe(true);
	await new Promise((resolve) => setTimeout(resolve, 2500));
	expect(rows("select socket from tmux_servers where socket = ?", socket)).toEqual([]);
	expect(rows("select id from tmux_panes where socket = ?", socket)).toEqual([]);
});

test("two live servers with the same pane id stay distinct", async () => {
	tmux("other", "new-session", "-d");
	const mainFirst = tmux("main", "display-message", "-p", "-t", "alpha:0.0", "#{pane_id}");
	const otherFirst = tmux("other", "display-message", "-p", "#{pane_id}");
	expect(otherFirst).toBe(mainFirst); // both servers number their first pane %0
	await vi.waitFor(() =>
		expect(rows("select socket from tmux_panes where id = ? order by socket", otherFirst)).toEqual(
			[socketOf("main"), socketOf("other")].sort().map((socket) => ({ socket })),
		),
	);
});

test("a Pi session in a tmux pane has its incarnation bound to that pane", async () => {
	const socket = socketOf("main");
	const pane = tmux("main", "display-message", "-p", "-t", "beta", "#{pane_id}");
	const tty = tmux("main", "display-message", "-p", "-t", "beta", "#{pane_tty}");
	vi.stubEnv("TMUX", `${rawSocketOf("main")},1,0`); // an alias of the server's socket path
	vi.stubEnv("TMUX_PANE", pane);
	const run = await fauxSession([bridge], [], []);
	try {
		const id = run.session.sessionManager.getSessionId();
		await vi.waitFor(() =>
			expect(rows("select tmux_socket, pane_id, pane_tty from incarnations where session_id = ?", id)).toEqual([
				{ tmux_socket: socket, pane_id: pane, pane_tty: tty },
			]),
		);
		expect(rows("select socket from tmux_servers where socket like ?", "%/main")).toEqual([{ socket }]);
	} finally {
		await close(run);
	}
});

test("a Pi session outside tmux has no pane binding", async () => {
	vi.stubEnv("TMUX", "");
	vi.stubEnv("TMUX_PANE", "");
	const run = await fauxSession([bridge], [], []);
	try {
		const id = run.session.sessionManager.getSessionId();
		await vi.waitFor(() =>
			expect(rows("select tmux_socket, pane_id, pane_tty from incarnations where session_id = ?", id)).toEqual([
				{ tmux_socket: null, pane_id: null, pane_tty: null },
			]),
		);
	} finally {
		await close(run);
	}
});

test("a window linked into a second session is recorded in both, as an event", async () => {
	const socket = socketOf("main");
	const window = tmux("main", "display-message", "-p", "-t", "beta:0", "#{window_id}");
	tmux("main", "link-window", "-d", "-s", "beta:0", "-t", "alpha:7");
	await vi.waitFor(() =>
		expect(
			rows(
				`select s.name, l.window_index from tmux_window_links l join tmux_sessions s on s.socket = l.socket and s.id = l.session_id
				where l.socket = ? and l.window_id = ? order by s.name`,
				socket,
				window,
			),
		).toEqual([
			{ name: "alpha", window_index: 7 },
			{ name: "beta", window_index: 0 },
		]),
	);
	expect(
		rows(
			"select type from events where type = 'tmux_window_link_added' and json_extract(data, '$.id') like ?",
			`%:${window}`,
		),
	).toHaveLength(2);
	tmux("main", "unlink-window", "-t", "alpha:7");
});

test("a server whose read fails keeps its rows until a read succeeds", async () => {
	tmux("locked", "new-session", "-d");
	const socket = socketOf("locked");
	await vi.waitFor(() => expect(rows("select id from tmux_panes where socket = ?", socket)).toHaveLength(1));
	chmodSync(socket, 0o000);
	try {
		await vi.waitFor(
			() =>
				expect(
					rows(
						"select type from events where type = 'tmux_server_read_failed' and json_extract(data, '$.socket') = ?",
						socket,
					),
				).toHaveLength(1),
			{ timeout: 3000 },
		);
		expect(rows("select id from tmux_panes where socket = ?", socket)).toHaveLength(1);
	} finally {
		chmodSync(socket, 0o700);
	}
	await new Promise((resolve) => setTimeout(resolve, 1500));
	expect(
		rows("select type from events where type like 'tmux_%_removed' and json_extract(data, '$.socket') = ?", socket),
	).toEqual([]);
});

test("a server that stops answering does not hold up the others", async () => {
	tmux("stuck", "new-session", "-d");
	const stuckPid = Number(tmux("stuck", "display-message", "-p", "#{pid}"));
	await vi.waitFor(() => expect(rows("select id from tmux_panes where socket = ?", socketOf("stuck"))).toHaveLength(1));
	process.kill(stuckPid, "SIGSTOP");
	try {
		const window = tmux("main", "new-window", "-d", "-P", "-F", "#{window_id}", "-t", "beta");
		await vi.waitFor(
			() =>
				expect(rows("select id from tmux_windows where socket = ? and id = ?", socketOf("main"), window)).toHaveLength(
					1,
				),
			{ timeout: 4000 },
		);
		expect(rows("select id from tmux_panes where socket = ?", socketOf("stuck"))).toHaveLength(1); // kept, not removed
	} finally {
		process.kill(stuckPid, "SIGCONT");
	}
});

test("conditional removal preserves live and respawned panes and removes only the expected dead process", async () => {
	const server = "departure-guard";
	tmux(server, "new-session", "-d");
	tmux(server, "set-option", "-g", "default-shell", "/bin/sh");
	tmux(server, "set-option", "-g", "remain-on-exit", "on");
	const pane = tmux(server, "new-window", "-d", "-P", "-F", "#{pane_id}", "exit 0");
	const status = () =>
		tmux(server, "display-message", "-p", "-t", pane, "#{pane_dead} #{pane_pid}").split(" ").map(Number);
	await vi.waitFor(() => expect(status()[0]).toBe(1));
	const oldPid = status()[1]!;
	tmux(server, "respawn-pane", "-k", "-t", pane, "exec sleep 600");
	await vi.waitFor(() => expect(status()[0]).toBe(0));
	await killPane(socketOf(server), pane, oldPid, AbortSignal.timeout(5000));
	expect(status()[0]).toBe(0);
	const livePid = status()[1]!;
	await killPane(socketOf(server), pane, livePid, AbortSignal.timeout(5000));
	expect(status()[0]).toBe(0);
	tmux(server, "respawn-pane", "-k", "-t", pane, "exit 0");
	await vi.waitFor(() => expect(status()[0]).toBe(1));
	const newPid = status()[1]!;
	expect(newPid).not.toBe(oldPid);
	await killPane(socketOf(server), pane, oldPid, AbortSignal.timeout(5000));
	expect(status()).toEqual([1, newPid]);
	await killPane(socketOf(server), pane, newPid, AbortSignal.timeout(5000));
	expect(tmux(server, "list-panes", "-a", "-F", "#{pane_id}").split("\n")).not.toContain(pane);
});
