import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
	fakeBridge,
	query,
	sendCommand,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { type Commands, openCommands } from "../src/backend/commands.js";
import { type Lifecycle, openLifecycle } from "../src/backend/lifecycle.js";
import { openWorldBackend, type WorldBackend } from "../src/backend/world-backend.js";
import type { WorldSnapshot } from "../src/world.js";

// Seam 1 for the inn (ticket 15): the backend API over a real session-state runtime. Stopped sessions sleep at the
// inn with their last task; waking one sends `start`, which the runtime carries out in a scratch tmux server whose
// windows find a fake `pi` first on PATH (never the operator's tmux or Pi); ending a session sends `close`, confirmed
// only while it is busy.
const state = tempStateDir();
const fakeDir = mkdtempSync(join(tmpdir(), "aw-inn-bin-"));
const piLog = join(fakeDir, "starts.jsonl");
// A window gets the PATH of the tmux client that opened it: the runtime, which inherits this one.
vi.stubEnv("PATH", `${fakeDir}:${process.env.PATH}`);
vi.stubEnv("FAKE_PI_LOG", piLog);
writeFileSync(
	join(fakeDir, "pi"),
	`#!${process.execPath}
const { appendFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { createConnection } = require("node:net");
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_PI_LOG, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const startedAt = Date.parse(execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8" }).trim());
const socket = createConnection(process.env.PI_CODING_AGENT_DIR + "/state/apple-pi.sock");
socket.on("connect", () => {
	socket.write(JSON.stringify({
		type: "hello",
		session: { id: flag("--session-id"), kind: "root", cwd: process.cwd(), name: flag("--name") },
		process: { pid: process.pid, startedAt },
		run: "idle",
		facts: { reportsTo: flag("--reports-to") ?? null },
		tmux: { socket: process.env.TMUX.split(",")[0], pane: process.env.TMUX_PANE },
	}) + "\\n");
	setInterval(() => socket.write('{"type":"heartbeat"}\\n'), 1000);
});
`,
);
chmodSync(join(fakeDir, "pi"), 0o755);

const TMUX_NAME = `aw-inn-${process.pid}`;
const tmux = (...args: string[]) =>
	execFileSync("tmux", ["-L", TMUX_NAME, "-f", "/dev/null", ...args], { encoding: "utf8", timeout: 5000 }).trim();
const workDir = mkdtempSync(join(tmpdir(), "aw-inn-work-"));

const processes: ReturnType<typeof standInProcess>[] = [];
const heartbeats: NodeJS.Timeout[] = [];
let world: WorldBackend;
let commands: Commands;
let lifecycle: Lifecycle;
let client: ChildProcess | undefined;
beforeAll(async () => {
	mkdirSync(process.env.TMUX_TMPDIR!, { recursive: true });
	tmux("new-session", "-d", "-s", "home", "-x", "100", "-y", "30");
	tmux("new-window", "-t", "home");
	await startRuntime(state.socketPath);
	world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	commands = openCommands(state.socketPath);
	lifecycle = openLifecycle({ db: state.dbPath, agentDir: state.agentDir }, commands, () => world.snapshot());
});
afterAll(async () => {
	world.close();
	commands.close();
	client?.kill();
	for (const beat of heartbeats) clearInterval(beat);
	for (const { child } of processes) child.kill();
	try {
		tmux("kill-server");
	} catch {}
	await stopRuntime(state);
	for (const dir of [fakeDir, workDir]) rmSync(dir, { recursive: true, force: true });
});

const latest = (): WorldSnapshot => world.snapshot();
const soon = (check: () => void, timeout = 5000) => vi.waitFor(check, { timeout });
const sleeper = (id: string) => latest().dormant?.find((agent) => agent.id === id);
const awake = (id: string) => latest().characters.find((character) => character.id === id);

/** A ledger task bundle whose `task.md` names it. */
function task(slug: string, title: string, status: string) {
	const bundle = join(state.agentDir, ".ledger", slug);
	mkdirSync(bundle, { recursive: true });
	writeFileSync(join(bundle, "task.md"), `Status: ${status}\n\n# ${title}\n`);
	return { bundle, taskId: slug };
}

/**
 * A top-level session on a fake bridge kept alive by heartbeats. It answers every command it is handed as applied
 * (a `close` also ends it, the way Pi quits); `stop` ends it the way Pi quits on its own.
 */
async function session(id: string, facts: Record<string, unknown> = {}, cwd = workDir) {
	const stand = standInProcess();
	processes.push(stand);
	const link = await fakeBridge(state.socketPath, id, stand.pid, stand.startedAt, {
		session: { cwd },
		facts: { config: { name: id, flags: [], activeTools: [], extensions: [], skills: [], mcpServers: [] }, ...facts },
	});
	link.socket.on("error", () => {});
	const beat = setInterval(() => link.send({ type: "heartbeat" }), 1000);
	heartbeats.push(beat);
	const handed: { kind: string }[] = [];
	const stop = () => {
		link.send({ type: "shutdown", reason: "quit" });
		clearInterval(beat);
		link.socket.end();
		stand.child.kill();
	};
	let buffer = "";
	link.socket.on("data", (chunk) => {
		buffer += chunk.toString();
		for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
			const message = JSON.parse(buffer.slice(0, end)) as {
				type: string;
				commandId: string;
				command: { kind: string };
			};
			buffer = buffer.slice(end + 1);
			if (message.type !== "command") continue;
			handed.push(message.command);
			link.send({ type: "command_progress", commandId: message.commandId, stage: "applied" });
			if (message.command.kind === "close") stop();
		}
	});
	await soon(() => expect(awake(id)).toBeDefined());
	return {
		send: link.send,
		handed,
		async stop() {
			stop();
			await soon(() => expect(sleeper(id)).toBeDefined());
		},
	};
}

test("stopped sessions sleep at the inn, the most recently stopped first, with their repository and last ledger task", async () => {
	await session("lead", { role: "coordinator" });
	const docs = await session("w-docs", {
		reportsTo: "lead",
		git: { repository: "/repos/handbook", worktree: "/repos/handbook", branch: "main" },
	});
	expect(
		await sendCommand(state.socketPath, "w-docs", {
			kind: "work",
			action: "take",
			cwd: state.agentDir,
			task: task("202610190000-style-guide", "Write the style guide", "in-progress").bundle,
		}),
	).toContainEqual({ stage: "applied" });
	await soon(() => expect(awake("w-docs")?.facts?.task?.title).toBe("Write the style guide"));
	const tests = await session("w-tests", { reportsTo: "lead" });
	await docs.stop();
	await tests.stop();

	expect(latest().dormant?.map((agent) => agent.id)).toEqual(["w-tests", "w-docs"]);
	expect(sleeper("w-docs")).toMatchObject({
		name: "w-docs",
		role: "worker",
		reportsTo: "lead",
		repository: "/repos/handbook",
		cwd: workDir,
		task: { title: "Write the style guide", status: "in-progress" },
		stopReason: "quit",
	});
	expect(sleeper("w-docs")?.stoppedAt).toBeTypeOf("number");
	expect(sleeper("w-tests")?.task).toBeNull();
	// Asleep is not awake: they are in no awake place, and the coordinator is not at the inn.
	expect(awake("w-docs")).toBeUndefined();
	expect(sleeper("lead")).toBeUndefined();
}, 30000);

test("waking needs a terminal to open the window beside", async () => {
	expect(await lifecycle.wake("w-docs")).toEqual({
		ok: false,
		reason: "No terminal is attached to tmux, so there is nowhere to open w-docs's window.",
	});
	expect(await lifecycle.wake("lead")).toEqual({ ok: false, reason: "lead is already awake." });
	expect(await lifecycle.wake("nobody")).toEqual({ ok: false, reason: "No stopped session has that id." });
	expect(existsSync(piLog)).toBe(false);
}, 20000);

/** Attach a client to the scratch server's `home` session through a pseudo-terminal, as a terminal app would. */
async function attachClient() {
	const script = [
		"import os, pty, sys",
		"pid, fd = pty.fork()",
		"if pid == 0:",
		`    os.execvp('tmux', ['tmux', '-L', '${TMUX_NAME}', 'attach', '-t', 'home:1'])`,
		"while True:",
		"    try:",
		"        os.read(fd, 65536)",
		"    except OSError:",
		"        break",
	].join("\n");
	client = spawn("python3", ["-c", script], { stdio: "ignore" });
	await soon(() => expect(tmux("list-clients", "-F", "#{client_tty}")).not.toBe(""));
}

test("waking starts a new incarnation in a new tmux window after the operator's pane, and the same character is awake in its place", async () => {
	await attachClient();
	const before = tmux("list-windows", "-t", "home", "-F", "#{window_index}").split("\n");
	expect(await lifecycle.wake("w-docs")).toEqual({ ok: true, stage: "applied" });

	// `pi --session-id` reopens the same session, with its name and the coordinator it reported to.
	const [start] = readFileSync(piLog, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as { args: string[]; cwd: string });
	expect(start.args).toEqual(["--session-id", "w-docs", "--name", "w-docs", "--reports-to", "lead"]);
	expect(
		query<{ command: string }>(
			state.dbPath,
			"select command from commands where session_id = 'w-docs' and kind = 'steer'",
		).map((row) => JSON.parse(row.command)),
	).toEqual([{ kind: "steer", text: "You have assigned work. Begin with your focused task." }]);
	// The new window opens right after the window the operator's client shows (window 1 of `home`).
	const windows = tmux("list-windows", "-t", "home", "-F", "#{window_index}:#{window_name}").split("\n");
	expect(windows).toHaveLength(before.length + 1);
	expect(windows[2]).toBe("2:w-docs");

	await soon(() =>
		expect(awake("w-docs")).toMatchObject({
			role: "worker",
			place: { kind: "wing", headquarters: "lead", repository: "/repos/handbook" },
		}),
	);
	expect(sleeper("w-docs")).toBeUndefined();
	const generations = query<{ generation: number }>(
		state.dbPath,
		"select generation from incarnations where session_id = ? order by generation",
		"w-docs",
	);
	expect(generations.map((row) => row.generation)).toEqual([1, 2]);
	expect(await lifecycle.wake("w-docs")).toEqual({ ok: false, reason: "w-docs is already awake." });
}, 40000);

test("ending a busy session asks to confirm first; ending an idle one, or a confirmed busy one, closes it and it sleeps at the inn", async () => {
	const busy = await session("w-busy", { reportsTo: "lead" });
	busy.send({ type: "run", run: "running_tool" });
	await soon(() => expect(awake("w-busy")?.facts?.run).toBe("running_tool"));
	expect(await lifecycle.endSession("w-busy")).toEqual({
		ok: false,
		confirm: true,
		reason: "w-busy is in the middle of a turn. Ending its session stops that turn.",
	});
	expect(query(state.dbPath, "select 1 from commands where session_id = 'w-busy'")).toHaveLength(0);
	expect(await lifecycle.endSession("w-busy", true)).toEqual({ ok: true, stage: "applied" });
	expect(busy.handed).toEqual([{ kind: "close" }]);
	await soon(() => expect(sleeper("w-busy")).toBeDefined());
	expect(latest().dormant?.[0].id).toBe("w-busy");

	const idle = await session("w-idle", { reportsTo: "lead" });
	expect(await lifecycle.endSession("w-idle")).toEqual({ ok: true, stage: "applied" });
	expect(idle.handed).toEqual([{ kind: "close" }]);
	await soon(() => expect(sleeper("w-idle")).toBeDefined());
	expect(await lifecycle.endSession("w-idle")).toEqual({ ok: false, reason: "That session is not running." });
}, 40000);
