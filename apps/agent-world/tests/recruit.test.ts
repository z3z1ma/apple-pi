import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import {
	fakeBridge,
	query,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { type Commands, openCommands } from "../src/backend/commands.js";
import { type Lifecycle, openLifecycle } from "../src/backend/lifecycle.js";
import { openWorldBackend, type WorldBackend } from "../src/backend/world-backend.js";
import type { WorldSnapshot } from "../src/world.js";

// Seam 1 for recruiting (ticket 10): the backend API over a real session-state runtime. Recruiting sends `start` for a
// new session, which the runtime carries out in a scratch tmux server whose windows find a fake `pi` first on PATH
// (never the operator's tmux or Pi): a worker opens after its coordinator's pane and reports to it; an independent
// agent opens after the pane of the operator's most recently active client and reports to nobody.
const state = tempStateDir();
const fakeDir = mkdtempSync(join(tmpdir(), "aw-recruit-bin-"));
const piLog = join(fakeDir, "starts.jsonl");
// A window gets the PATH of the tmux client that opened it: the runtime and this file, which share it.
vi.stubEnv("PATH", `${fakeDir}:${process.env.PATH}`);
vi.stubEnv("FAKE_PI_LOG", piLog);
// The fake Pi joins the runtime the way Pi's bridge does: in its directory, as its own repository, with its flags.
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
		facts: {
			reportsTo: flag("--reports-to") ?? null,
			role: flag("--role") ?? null,
			git: { repository: process.cwd(), worktree: process.cwd(), branch: "main" },
			config: { name: flag("--name"), flags: [], activeTools: [], extensions: [], skills: [], mcpServers: [] },
		},
		tmux: { socket: process.env.TMUX.split(",")[0], pane: process.env.TMUX_PANE },
	}) + "\\n");
	setInterval(() => socket.write('{"type":"heartbeat"}\\n'), 1000);
});
`,
);
chmodSync(join(fakeDir, "pi"), 0o755);

const TMUX_NAME = `aw-recruit-${process.pid}`;
const tmux = (...args: string[]) =>
	execFileSync("tmux", ["-L", TMUX_NAME, "-f", "/dev/null", ...args], { encoding: "utf8", timeout: 5000 }).trim();
const workDir = realpathSync(mkdtempSync(join(tmpdir(), "aw-recruit-work-")));
const otherDir = realpathSync(mkdtempSync(join(tmpdir(), "aw-recruit-other-")));

let world: WorldBackend;
let commands: Commands;
let lifecycle: Lifecycle;
let client: ChildProcess | undefined;
beforeAll(async () => {
	mkdirSync(process.env.TMUX_TMPDIR!, { recursive: true });
	tmux("new-session", "-d", "-s", "home", "-x", "100", "-y", "30");
	await startRuntime(state.socketPath);
	world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	commands = openCommands(state.socketPath);
	lifecycle = openLifecycle({ db: state.dbPath }, commands, () => world.snapshot());
});
afterAll(async () => {
	world.close();
	commands.close();
	client?.kill();
	try {
		tmux("kill-server");
	} catch {}
	await stopRuntime(state);
	for (const dir of [fakeDir, workDir, otherDir]) rmSync(dir, { recursive: true, force: true });
});

const latest = (): WorldSnapshot => world.snapshot();
const soon = (check: () => void, timeout = 8000) => vi.waitFor(check, { timeout });
const awake = (id: string) => latest().characters.find((character) => character.id === id);
const windows = () => tmux("list-windows", "-t", "home", "-F", "#{window_index}:#{window_name}").split("\n");
const starts = () =>
	existsSync(piLog)
		? readFileSync(piLog, "utf8")
				.trim()
				.split("\n")
				.map((line) => JSON.parse(line) as { args: string[]; cwd: string })
		: [];

/** Attach a client to the scratch server's first window through a pseudo-terminal, as a terminal app would. */
async function attachClient() {
	const script = [
		"import os, pty, sys",
		"pid, fd = pty.fork()",
		"if pid == 0:",
		`    os.execvp('tmux', ['tmux', '-L', '${TMUX_NAME}', 'attach', '-t', 'home:0'])`,
		"while True:",
		"    try:",
		"        os.read(fd, 65536)",
		"    except OSError:",
		"        break",
	].join("\n");
	client = spawn("python3", ["-c", script], { stdio: "ignore" });
	await soon(() => expect(tmux("list-clients", "-F", "#{client_tty}")).not.toBe(""));
}

test("the coordinator runs in its own tmux window, in the headquarters", async () => {
	// Window 1 of `home`; the operator's client will show window 0, so a worker opening after window 1 is the coordinator's.
	tmux(
		"new-window",
		"-t",
		"home",
		"-n",
		"lead",
		"-c",
		otherDir,
		"pi",
		"--session-id",
		"lead",
		"--name",
		"lead",
		"--role",
		"coordinator",
	);
	await soon(() => expect(awake("lead")).toMatchObject({ role: "coordinator", place: { kind: "headquarters" } }));
	expect(awake("lead")?.facts?.tmux?.pane).toMatch(/^%\d+$/);
}, 20000);

test("recruiting refuses what Pi could not start, and sends nothing", async () => {
	const before = starts().length;
	const cases: [Parameters<Lifecycle["recruit"]>[0], string][] = [
		[{ name: "  ", cwd: workDir, brief: "", reportsTo: "lead" }, "Give the new agent a name."],
		[{ name: "docs", cwd: "", brief: "", reportsTo: "lead" }, "Choose the directory it works in."],
		[
			{ name: "docs", cwd: "relative/dir", brief: "", reportsTo: "lead" },
			"relative/dir is not a full path to a directory.",
		],
		[
			{ name: "docs", cwd: join(workDir, "missing"), brief: "", reportsTo: "lead" },
			`${join(workDir, "missing")} is not a directory.`,
		],
		[
			{ name: "docs", cwd: workDir, brief: "--model x", reportsTo: "lead" },
			"The brief cannot start with a dash: Pi would read it as an option.",
		],
		[{ name: "docs", cwd: workDir, brief: "", reportsTo: "nobody" }, "That coordinator is not running."],
		// No client is attached yet, so an independent agent has nowhere to open.
		[
			{ name: "scout", cwd: workDir, brief: "" },
			"No terminal is attached to tmux, so there is nowhere to open scout's window.",
		],
	];
	for (const [request, reason] of cases) expect(await lifecycle.recruit(request)).toEqual({ ok: false, reason });
	expect(starts()).toHaveLength(before);
	expect(query(state.dbPath, "select 1 from commands where kind = 'start'")).toHaveLength(0);
}, 20000);

test("recruiting a worker sends start reporting to the coordinator; its window opens after the coordinator's, and it walks into its wing", async () => {
	await attachClient();
	const brief = "Write the style guide.\nKeep it short.";
	const receipt = await lifecycle.recruit({ name: " docs ", cwd: workDir, brief, reportsTo: "lead" });
	expect(receipt).toMatchObject({ ok: true, stage: "applied" });
	const id = (receipt as { sessionId: string }).sessionId;
	expect(id).toMatch(/^[0-9a-f-]{36}$/);

	const command = query<{ command: string }>(state.dbPath, "select command from commands where session_id = ?", id);
	expect(JSON.parse(command[0].command)).toMatchObject({
		kind: "start",
		cwd: workDir,
		name: "docs",
		reportsTo: "lead",
		prompt: brief,
		tmux: { pane: awake("lead")?.facts?.tmux?.pane },
	});
	const start = starts().at(-1)!;
	expect(start.args).toEqual(["--session-id", id, "--name", "docs", "--reports-to", "lead", brief]);
	expect(realpathSync(start.cwd)).toBe(workDir);
	// After the coordinator's window (1), not after the window the operator's client shows (0).
	expect(windows().slice(1)).toEqual(["1:lead", "2:docs"]);

	await soon(() =>
		expect(awake(id)).toMatchObject({
			name: "docs",
			role: "worker",
			place: { kind: "wing", headquarters: "lead", repository: workDir },
		}),
	);
	expect(
		latest()
			.headquarters.find((hq) => hq.id === "lead")
			?.wings.map((wing) => wing.repository),
	).toContain(workDir);
}, 40000);

test("recruiting an independent agent sends start reporting to nobody, after the operator's pane, and it stands in the square", async () => {
	const receipt = await lifecycle.recruit({ name: "scout", cwd: otherDir, brief: "" });
	expect(receipt).toMatchObject({ ok: true, stage: "applied" });
	const id = (receipt as { sessionId: string }).sessionId;
	const command = query<{ command: string }>(state.dbPath, "select command from commands where session_id = ?", id);
	const sent = JSON.parse(command[0].command);
	expect(sent).toMatchObject({ kind: "start", cwd: otherDir, name: "scout" });
	expect(sent).not.toHaveProperty("reportsTo");
	expect(sent).not.toHaveProperty("prompt");
	expect(starts().at(-1)!.args).toEqual(["--session-id", id, "--name", "scout"]);
	// Right after window 0, which the operator's client shows.
	expect(windows().slice(1)).toEqual(["1:scout", "2:lead", "3:docs"]);
	await soon(() => expect(awake(id)).toMatchObject({ name: "scout", role: "independent", place: { kind: "square" } }));
}, 40000);

test("recruiting for a coordinator that runs outside tmux says so, and sends nothing", async () => {
	const stand = standInProcess();
	const link = await fakeBridge(state.socketPath, "hq-2", stand.pid, stand.startedAt, {
		session: { cwd: otherDir, name: "hq-2" },
		facts: {
			role: "coordinator",
			config: { name: "hq-2", flags: [], activeTools: [], extensions: [], skills: [], mcpServers: [] },
		},
	});
	link.socket.on("error", () => {});
	const beat = setInterval(() => link.send({ type: "heartbeat" }), 1000);
	try {
		await soon(() => expect(awake("hq-2")?.role).toBe("coordinator"));
		const before = starts().length;
		expect(await lifecycle.recruit({ name: "docs-2", cwd: workDir, brief: "", reportsTo: "hq-2" })).toEqual({
			ok: false,
			reason: "hq-2 is not running in tmux, so there is nowhere to open docs-2's window beside it.",
		});
		expect(starts()).toHaveLength(before);
	} finally {
		clearInterval(beat);
		link.socket.destroy();
		stand.child.kill();
	}
}, 20000);
