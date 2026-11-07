import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkerOptions } from "node:worker_threads";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { statePaths } from "../src/paths.js";
import { Runtime } from "../src/runtime.js";
import { killPane, listPanes, type PaneRow, renameWindow } from "../src/tmux.js";
import { close, fakeBridge, query, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

vi.mock("node:worker_threads", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:worker_threads")>();
	return {
		...actual,
		Worker: class extends actual.Worker {
			constructor(filename: string | URL, options?: WorkerOptions) {
				super(filename, { ...options, execArgv: ["--import", new URL("../src/register.mjs", import.meta.url).href] });
			}
		},
	};
});

const tmuxDir = mkdtempSync(join(tmpdir(), "apt-"));
const state = tempStateDir();
vi.stubEnv("TMUX_TMPDIR", tmuxDir);
const servers = new Set<string>();

function tmux(server: string, ...args: string[]): string {
	servers.add(server);
	return execFileSync("tmux", ["-L", server, "-f", "/dev/null", ...args], { encoding: "utf8" }).trim();
}
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
	expect(otherFirst).toBe(mainFirst);
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
	vi.stubEnv("TMUX", `${rawSocketOf("main")},1,0`);
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

test("a claimed binding without pane-process ownership leaves the shell window unchanged", async () => {
	const pane = tmux("main", "display-message", "-p", "-t", "beta", "#{pane_id}");
	const label = tmux("main", "display-message", "-p", "-t", pane, "#{window_name}");
	vi.stubEnv("TMUX", `${rawSocketOf("main")},1,0`);
	vi.stubEnv("TMUX_PANE", pane);
	const run = await fauxSession([bridge], [], []);
	try {
		run.session.setSessionName("Not the shell owner");
		await vi.waitFor(() =>
			expect(rows("select name from sessions where id = ?", run.session.sessionManager.getSessionId())).toEqual([
				{ name: "Not the shell owner" },
			]),
		);
		await new Promise((resolve) => setTimeout(resolve, 2200));
		expect(tmux("main", "display-message", "-p", "-t", pane, "#{window_name}")).toBe(label);
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
		expect(rows("select id from tmux_panes where socket = ?", socketOf("stuck"))).toHaveLength(1);
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

test("conditional window rename preserves changed composition, respawned, moved, dead and missing panes", async () => {
	const server = "name-guard";
	tmux(server, "new-session", "-d");
	tmux(server, "set-option", "-g", "default-shell", "/bin/sh");
	const pane = tmux(server, "new-window", "-d", "-P", "-F", "#{pane_id}", "-n", "initial", "exec sleep 600");
	const socket = socketOf(server);
	const snapshot = async () => {
		const panes = await listPanes(socket, { timeout: 1000, signal: AbortSignal.timeout(5000) });
		expect(panes).not.toBe("absent");
		return { pane: (panes as PaneRow[]).find((row) => row.paneId === pane)!, panes: panes as PaneRow[] };
	};
	const rename = (value: Awaited<ReturnType<typeof snapshot>>, name: string, signal = AbortSignal.timeout(5000)) =>
		renameWindow(socket, value.pane, value.panes, name, signal);
	const label = () => tmux(server, "display-message", "-p", "-t", pane, "#{window_name}");
	const launched = await snapshot();
	await rename(launched, "Pi Name");
	expect(label()).toBe("Pi Name");
	tmux(server, "new-session", "-d", "-s", "linked");
	tmux(server, "link-window", "-s", pane, "-t", "linked");
	await rename(await snapshot(), "Linked Pi");
	expect(label()).toBe("Linked Pi");
	tmux(server, "split-window", "-d", "-t", pane, "exec sleep 600");
	await rename(launched, "stale composition");
	expect(label()).toBe("Linked Pi");
	const original = await snapshot();
	tmux(server, "respawn-pane", "-k", "-t", pane, "exec sleep 600");
	await vi.waitFor(async () => expect((await snapshot()).pane.pid).not.toBe(original.pane.pid));
	tmux(server, "rename-window", "-t", pane, "replacement");
	await rename(original, "old person");
	expect(label()).toBe("replacement");
	const replacement = await snapshot();
	const destination = tmux(server, "new-window", "-d", "-P", "-F", "#{pane_id}", "-n", "destination");
	tmux(server, "join-pane", "-d", "-s", pane, "-t", destination);
	await rename(replacement, "old window");
	expect(label()).toBe("destination");
	const moved = await snapshot();
	tmux(server, "set-option", "-w", "-t", pane, "remain-on-exit", "on");
	process.kill(moved.pane.pid, "SIGTERM");
	await vi.waitFor(async () => expect((await snapshot()).pane.dead).toBe(1));
	await rename(moved, "dead person");
	expect(label()).toBe("destination");
	await expect(rename(moved, "aborted", AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
	tmux(server, "kill-pane", "-t", pane);
	await rename(moved, "missing person");
	expect(tmux(server, "display-message", "-p", "-t", destination, "#{window_name}")).toBe("destination");
}, 15000);

test.each([
	"shared",
	"rename",
	"disconnect",
	"switch",
	"inflight-shared",
	"inflight-rename",
	"inflight-disconnect",
	"inflight-switch",
	"pending-shared",
])(
	"queued window rename rechecks %s ownership",
	async (change) => {
		const isolated = tempStateDir();
		vi.stubEnv("TMUX_TMPDIR", tmuxDir);
		const paths = statePaths();
		const runtime = new Runtime(paths);
		const server = `queued-${change}`;
		tmux(server, "new-session", "-d");
		const untouched = tmux(server, "display-message", "-p", "#{pane_id}");
		tmux(server, "rename-window", "-t", untouched, "unrelated notes");
		tmux(server, "set-option", "-g", "default-shell", "/bin/sh");
		const socket = socketOf(server);
		const serverPid = Number(tmux(server, "display-message", "-p", "#{pid}"));
		const inflight = change.startsWith("inflight-");
		const ownWrite = inflight || change.startsWith("pending-");
		const transition = change.replace(/^(inflight|pending)-/, "");
		const lateJoin = ownWrite && transition === "shared";
		let suspended = false;
		const people: { id: string; name: string; pane: string; pid: number; startedAt: number }[] = [];
		const links: Awaited<ReturnType<typeof fakeBridge>>[] = [];
		let release!: () => void;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		let paused = false;
		let interrupted: Promise<string | null> | undefined;
		let writeSignal: AbortSignal | undefined;
		const original = renameWindow;
		const spy = vi.spyOn(await import("../src/tmux.js"), "renameWindow").mockImplementation(async (...args) => {
			if (ownWrite && !paused && args[1].paneId === people[1]?.pane) {
				if (inflight) {
					process.kill(serverPid, "SIGSTOP");
					suspended = true;
				}
				writeSignal = args[4];
				const pending = (async () => {
					if (!inflight) await gate;
					return original(...args);
				})();
				interrupted = pending.then(
					() => null,
					(error: Error) => error.name,
				);
				paused = true;
				return pending;
			}
			if (!ownWrite && args[1].paneId === people[0]?.pane) {
				paused = true;
				await gate;
			}
			return original(...args);
		});
		try {
			expect(await runtime.start()).toBe(true);
			for (const [id, name] of [
				["a-blocker", "Blocker Person"],
				["b-target", "Target Person"],
				["c-joiner", "Joining Person"],
			]) {
				const lateJoiner = lateJoin && id === "c-joiner";
				const pane = lateJoiner
					? tmux(server, "split-window", "-d", "-P", "-F", "#{pane_id}", "-t", people[1]!.pane, "exec sleep 600")
					: tmux(server, "new-window", "-d", "-P", "-F", "#{pane_id}", "-n", name!, "exec sleep 600");
				const pid = Number(tmux(server, "display-message", "-p", "-t", pane, "#{pane_pid}"));
				const startedAt = Date.parse(
					execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim(),
				);
				const person = { id: id!, name: name!, pane, pid, startedAt };
				people.push(person);
				if (lateJoiner) continue;
				const link = await fakeBridge(paths.socket, person.id, pid, startedAt, {
					session: { cwd: isolated.agentDir, name },
					tmux: { socket, pane },
				});
				links.push(link);
			}
			await vi.waitFor(
				() =>
					expect(query(paths.db, "select pane_id from incarnations where tmux_socket = ?", socket)).toHaveLength(
						lateJoin ? 2 : 3,
					),
				{ timeout: 4000 },
			);
			const blocker = people[0]!;
			const target = people[1]!;
			const history = join(isolated.agentDir, "target-labels");
			tmux(
				server,
				"set-hook",
				"-w",
				"-t",
				target.pane,
				"after-rename-window",
				`run-shell 'printf "%s\\n" "#{window_name}" >> ${history}'`,
			);
			tmux(
				server,
				"rename-window",
				"-t",
				target.pane,
				lateJoin ? "joint notes" : "drift target",
				";",
				"rename-window",
				"-t",
				blocker.pane,
				"drift blocker",
			);
			await vi.waitFor(() => expect(paused).toBe(true), { timeout: 4000 });
			let expected = "Renamed Target";
			if (lateJoin) {
				const joiner = people[2]!;
				links.push(
					await fakeBridge(paths.socket, joiner.id, joiner.pid, joiner.startedAt, {
						session: { cwd: isolated.agentDir, name: joiner.name },
						tmux: { socket, pane: joiner.pane },
					}),
				);
				await vi.waitFor(() =>
					expect(query(paths.db, "select name from sessions where id = ?", joiner.id)).toEqual([{ name: joiner.name }]),
				);
				expected = "joint notes";
			} else if (transition === "shared") {
				tmux(server, "join-pane", "-d", "-s", people[2]!.pane, "-t", target.pane);
				tmux(server, "rename-window", "-t", target.pane, "joint notes");
				expected = "joint notes";
			} else if (transition === "disconnect") {
				links[1]!.socket.destroy();
				await vi.waitFor(() =>
					expect(
						query(
							paths.db,
							"select 1 from events where session_id = ? and type = 'execution' and json_extract(data, '$.phase') = 'break'",
							target.id,
						),
					).toHaveLength(1),
				);
				expected = "drift target";
			} else if (transition === "switch") {
				links[1]!.send({
					type: "hello",
					session: { id: "switched-target", kind: "root", cwd: isolated.agentDir, name: expected },
					process: { pid: target.pid, startedAt: target.startedAt },
					run: "idle",
					facts: {},
					tmux: { socket, pane: target.pane },
				});
				await vi.waitFor(() =>
					expect(query(paths.db, "select name from sessions where id = 'switched-target'")).toEqual([
						{ name: expected },
					]),
				);
			} else {
				links[1]!.send({
					type: "facts",
					facts: { config: { name: expected, flags: [], activeTools: [], extensions: [], skills: [], mcpServers: [] } },
				});
				await vi.waitFor(() =>
					expect(query(paths.db, "select name from sessions where id = ?", target.id)).toEqual([{ name: expected }]),
				);
			}
			release();
			if (ownWrite) {
				expect(await interrupted).toBe("AbortError");
				expect(writeSignal?.reason).toMatchObject({ name: "AbortError" });
				await vi.waitFor(() => {
					const clients = execFileSync("ps", ["-axww", "-o", "ppid=,command="], { encoding: "utf8" })
						.split("\n")
						.filter(
							(line) =>
								Number(line.trim().split(/\s+/, 1)[0]) === process.pid &&
								line.includes(socket) &&
								line.includes("if-shell"),
						);
					expect(clients).toHaveLength(0);
				});
				if (suspended) {
					process.kill(serverPid, "SIGCONT");
					suspended = false;
				}
			}
			const window = tmux(server, "display-message", "-p", "-t", blocker.pane, "#{window_id}");
			await vi.waitFor(
				() =>
					expect(query(paths.db, "select name from tmux_windows where socket = ? and id = ?", socket, window)).toEqual([
						{ name: blocker.name },
					]),
				{ timeout: 4000 },
			);
			if (inflight) await new Promise((resolve) => setTimeout(resolve, 2200));
			const allowed =
				inflight && (transition === "shared" || transition === "disconnect") ? [expected, target.name] : [expected];
			await vi.waitFor(
				() => expect(allowed).toContain(tmux(server, "display-message", "-p", "-t", target.pane, "#{window_name}")),
				{ timeout: 4000 },
			);
			if (!inflight) expect(readFileSync(history, "utf8").split("\n")).not.toContain(target.name);
			expect(tmux(server, "display-message", "-p", "-t", untouched, "#{window_name}")).toBe("unrelated notes");
		} finally {
			if (suspended) process.kill(serverPid, "SIGCONT");
			release();
			spy.mockRestore();
			for (const link of links) link.socket.destroy();
			await runtime.stop();
			tmux(server, "kill-server");
			rmSync(isolated.agentDir, { recursive: true, force: true });
			vi.stubEnv("PI_CODING_AGENT_DIR", state.agentDir);
		}
	},
	15000,
);
