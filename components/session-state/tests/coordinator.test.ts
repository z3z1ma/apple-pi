import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { close, query, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

// A scratch tmux server under its own TMUX_TMPDIR, whose windows find a fake `pi` first on PATH. The fake records
// how it was started and connects to the runtime as that session's bridge, as a real Pi would.
const tmuxDir = mkdtempSync(join(tmpdir(), "apc-"));
const fakeDir = mkdtempSync(join(tmpdir(), "apc-bin-"));
const workDir = realpathSync(mkdtempSync(join(tmpdir(), "apc-work-")));
const piLog = join(fakeDir, "starts.jsonl");
const state = tempStateDir();
vi.stubEnv("TMUX_TMPDIR", tmuxDir);
// A window gets the PATH of the tmux client that opened it, here the runtime, which inherits this one.
vi.stubEnv("PATH", `${fakeDir}:${process.env.PATH}`);
vi.stubEnv("FAKE_PI_LOG", piLog);
writeFileSync(
	join(fakeDir, "pi"),
	`#!${process.execPath}
const { appendFileSync } = require("node:fs");
const { execFileSync } = require("node:child_process");
const { createConnection } = require("node:net");
process.on("uncaughtException", (error) => {
	appendFileSync(process.env.FAKE_PI_LOG + ".err", String(error.stack) + "\\n");
	process.exit(1);
});
const args = process.argv.slice(2);
appendFileSync(process.env.FAKE_PI_LOG, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");
if (args.at(-1) === "@fail") process.exit(1);
const id = args[args.indexOf("--session-id") + 1];
const startedAt = Date.parse(execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8" }).trim());
const socket = createConnection(process.env.PI_CODING_AGENT_DIR + "/state/apple-pi.sock");
socket.on("connect", () => {
	socket.write(JSON.stringify({
		type: "hello",
		session: { id, kind: "root", cwd: process.cwd(), name: args.includes("--name") ? args[args.indexOf("--name") + 1] : undefined },
		process: { pid: process.pid, startedAt },
		run: "idle",
		facts: {},
		tmux: { socket: process.env.TMUX.split(",")[0], pane: process.env.TMUX_PANE },
	}) + "\\n");
	setInterval(() => socket.write('{"type":"heartbeat"}\\n'), 1000);
});
`,
);
chmodSync(join(fakeDir, "pi"), 0o755);

const tmux = (...args: string[]) =>
	execFileSync("tmux", ["-L", "coord", "-f", "/dev/null", ...args], {
		encoding: "utf8",
		env: { ...process.env, PATH: `${fakeDir}:${process.env.PATH}`, FAKE_PI_LOG: piLog },
	}).trim();

beforeAll(async () => {
	tmux("new-session", "-d", "-s", "home", "-x", "120", "-y", "40");
	const socket = tmux("display-message", "-p", "#{socket_path}");
	vi.stubEnv("TMUX", `${socket},1,0`);
	vi.stubEnv("TMUX_PANE", tmux("display-message", "-p", "-t", "home", "#{pane_id}"));
	await startRuntime(state.socketPath);
});
afterAll(async () => {
	try {
		execFileSync("tmux", ["-L", "coord", "kill-server"], { stdio: "ignore" });
	} catch {}
	await stopRuntime(state);
	for (const dir of [tmuxDir, fakeDir, workDir]) rmSync(dir, { recursive: true, force: true });
});

const call = (name: string, args: Parameters<typeof fauxToolCall>[1]): Reply =>
	fauxAssistantMessage([fauxToolCall(name, args)], { stopReason: "toolUse" });
const starts = () =>
	readFileSync(piLog, "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line) as { args: string[]; cwd: string });
const incarnation = (id: string) =>
	query<{ generation: number; ended_at: number | null; end_reason: string | null; process_state: string }>(
		state.dbPath,
		"select generation, ended_at, end_reason, process_state from incarnations where session_id = ? order by generation desc limit 1",
		id,
	)[0];
const toolResults = (run: Awaited<ReturnType<typeof coordinator>>) =>
	run.session.messages.flatMap((m) =>
		m.role === "toolResult" ? [{ isError: m.isError, text: JSON.stringify(m.content) }] : [],
	);

/** A session started with --coordinator whose model makes the given tool calls in turn. */
async function coordinator(calls: Reply[]) {
	const run = await fauxSession([bridge], [...calls, fauxAssistantMessage("done")], []);
	run.session.extensionRunner.setFlagValue("coordinator", true);
	return run;
}

test("a coordinator starts a session in a new tmux window, and reopens it by id once it stopped", async () => {
	const run = await coordinator([
		call("start_peer_session", { cwd: workDir, name: "docs", prompt: "@brief.md", session_id: "worker-1" }),
		fauxAssistantMessage("started"),
		call("reopen_peer_session", { session_id: "worker-1" }),
	]);
	const coordinatorId = run.session.sessionManager.getSessionId();
	try {
		await run.session.prompt("start a docs worker");
		expect(toolResults(run)[0]).toMatchObject({
			isError: false,
			text: expect.stringContaining("Started session worker-1"),
		});
		expect(starts()[0]).toEqual({
			args: ["--session-id", "worker-1", "--name", "docs", "--reports-to", coordinatorId, "@brief.md"],
			cwd: workDir,
		});
		expect(tmux("list-windows", "-a", "-F", "#{window_name}").split("\n")).toContain("docs");
		expect(query(state.dbPath, "select stage from commands where session_id = 'worker-1'")).toEqual([
			{ stage: "applied" },
		]);
		expect(incarnation("worker-1")).toMatchObject({ generation: 1, ended_at: null });

		tmux("kill-window", "-t", "docs");
		await vi.waitFor(() => expect(incarnation("worker-1").ended_at).not.toBeNull(), { timeout: 15000 });
		await run.session.prompt("bring it back");
		expect(toolResults(run)[1]).toMatchObject({
			isError: false,
			text: expect.stringContaining("Reopened session worker-1"),
		});
		expect(starts()[1]).toEqual({
			args: ["--session-id", "worker-1", "--name", "docs", "--reports-to", coordinatorId],
			cwd: workDir,
		});
		expect(incarnation("worker-1")).toMatchObject({ generation: 2, ended_at: null });
	} finally {
		await close(run);
		try {
			tmux("kill-window", "-t", "docs");
		} catch {}
	}
}, 40000);

test("starting a session fails when its window closes before the session connects", async () => {
	const run = await coordinator([call("start_peer_session", { cwd: workDir, name: "broken", prompt: "@fail" })]);
	try {
		await run.session.prompt("start a broken worker");
		expect(toolResults(run)[0]).toMatchObject({
			isError: true,
			text: expect.stringContaining("the window closed before the session started"),
		});
	} finally {
		await close(run);
	}
}, 30000);

test("a coordinator closes a running session, which records its exit", async () => {
	const worker = await fauxSession([bridge], [], []);
	const workerId = worker.session.sessionManager.getSessionId();
	await worker.session.bindExtensions({
		shutdownHandler: () => void worker.session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" }),
	});
	const run = await coordinator([call("close_peer_session", { session_id: workerId })]);
	try {
		await vi.waitFor(() => expect(incarnation(workerId)).toMatchObject({ ended_at: null }), { timeout: 15000 });
		await run.session.prompt("close the worker");
		expect(toolResults(run)[0]).toMatchObject({ isError: false });
		await vi.waitFor(() =>
			expect(incarnation(workerId)).toMatchObject({ process_state: "exited", end_reason: "quit" }),
		);
	} finally {
		await close(worker);
		await close(run);
	}
}, 30000);

test("only a session started with --coordinator has the lifecycle tools", async () => {
	const run = await fauxSession(
		[bridge],
		[fauxAssistantMessage("ok")],
		["start_peer_session", "reopen_peer_session", "close_peer_session", "list_peer_sessions"],
	);
	try {
		await run.session.prompt("hi");
		expect(run.session.getActiveToolNames()).toEqual(["list_peer_sessions"]);
	} finally {
		await close(run);
	}
}, 20000);

test.each([false, true])(
	"a root can discover peers when its initial tool set lacks peer tools (coordinator=%s)",
	async (enabled) => {
		const run = await fauxSession([bridge], [call("list_peer_sessions", {}), fauxAssistantMessage("done")], ["read"]);
		run.session.extensionRunner.setFlagValue("coordinator", enabled);
		try {
			await run.session.prompt("list my peers");
			expect(toolResults(run)[0]).toMatchObject({ isError: false });
			expect(run.session.getActiveToolNames().sort()).toEqual(
				(enabled
					? ["read", "list_peer_sessions", "start_peer_session", "reopen_peer_session", "close_peer_session"]
					: ["read", "list_peer_sessions"]
				).sort(),
			);
		} finally {
			await close(run);
		}
	},
	20000,
);
