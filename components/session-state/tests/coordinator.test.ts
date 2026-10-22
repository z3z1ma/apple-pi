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
// Simulate the title extension assigning a name in the newly started session.
const name = args.includes("--name") ? args[args.indexOf("--name") + 1] : "Ada Lovelace";
execFileSync("tmux", ["rename-window", "-t", process.env.TMUX_PANE, name]);
const startedAt = Date.parse(execFileSync("ps", ["-o", "lstart=", "-p", String(process.pid)], { encoding: "utf8" }).trim());
const socket = createConnection(process.env.PI_CODING_AGENT_DIR + "/state/apple-pi.sock");
socket.on("connect", () => {
	socket.write(JSON.stringify({
		type: "hello",
		session: { id, kind: "root", cwd: process.cwd(), name },
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

/** A session started with `--role coordinator` whose model makes the given tool calls in turn. */
async function coordinator(calls: Reply[]) {
	const run = await fauxSession([bridge], [...calls, fauxAssistantMessage("done")], []);
	await withRole(run, "coordinator");
	return run;
}

/** Restart the session with `--role <name>` (a new session_start reads the flag) and wait until the runtime records the role. */
async function withRole(run: Awaited<ReturnType<typeof fauxSession>>, role: string | undefined) {
	if (!role) return; // unroled is the default
	const id = run.session.sessionManager.getSessionId();
	run.session.extensionRunner.setFlagValue("role", role);
	await run.session.bindExtensions({});
	await vi.waitFor(
		() => expect(query(state.dbPath, "select role from sessions where id = ?", id)).toEqual([{ role }]),
		{
			timeout: 15000,
		},
	);
}

test("a coordinator starts a session in a new tmux window, and reopens it by id once it stopped", async () => {
	const run = await coordinator([
		call("hire", {
			cwd: workDir,
			role: "repository-archaeologist",
			prompt: "@brief.md",
			session_id: "worker-1",
		}),
		fauxAssistantMessage("started"),
		call("rehire", { person: "worker-1" }),
	]);
	const coordinatorId = run.session.sessionManager.getSessionId();
	try {
		await run.session.prompt("start a docs worker");
		expect(toolResults(run)[0]).toMatchObject({
			isError: false,
			text: expect.stringContaining("Hired a new person (worker-1) as repository-archaeologist."),
		});
		expect(starts()[0]).toEqual({
			args: [
				"--session-id",
				"worker-1",
				"--reports-to",
				coordinatorId,
				"--role",
				"repository-archaeologist",
				"@brief.md",
			],
			cwd: workDir,
		});
		expect(tmux("list-windows", "-a", "-F", "#{window_name}").split("\n")).toContain("Ada Lovelace");
		expect(query(state.dbPath, "select stage from commands where session_id = 'worker-1'")).toEqual([
			{ stage: "applied" },
		]);
		expect(incarnation("worker-1")).toMatchObject({ generation: 1, ended_at: null });

		tmux("kill-window", "-t", "Ada Lovelace");
		await vi.waitFor(() => expect(incarnation("worker-1").ended_at).not.toBeNull(), { timeout: 15000 });
		await run.session.prompt("bring it back");
		expect(toolResults(run)[1]).toMatchObject({
			isError: false,
			text: expect.stringContaining("worker-1 is back (worker-1)."),
		});
		expect(starts()[1]).toEqual({
			args: ["--session-id", "worker-1", "--name", "Ada Lovelace", "--reports-to", coordinatorId],
			cwd: workDir,
		});
		expect(incarnation("worker-1")).toMatchObject({ generation: 2, ended_at: null });
	} finally {
		await close(run);
		try {
			tmux("kill-window", "-t", "Ada Lovelace");
		} catch {}
	}
}, 40000);

test("starting a session fails when its window closes before the session connects", async () => {
	const run = await coordinator([call("hire", { cwd: workDir, role: "repository-archaeologist", prompt: "@fail" })]);
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
	const run = await coordinator([call("send_home", { person: workerId })]);
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

test("a coordinator renames a running peer through its bridge", async () => {
	const worker = await fauxSession([bridge], [], []);
	const workerId = worker.session.sessionManager.getSessionId();
	const run = await coordinator([call("rename", { person: workerId, name: "Renamed worker" })]);
	try {
		await vi.waitFor(() => expect(incarnation(workerId)).toMatchObject({ ended_at: null }), { timeout: 15000 });
		await run.session.prompt("rename the worker");
		expect(toolResults(run)[0]).toMatchObject({ isError: false });
		expect(worker.session.sessionManager.getSessionName()).toBe("Renamed worker");
	} finally {
		await close(worker);
		await close(run);
	}
}, 30000);

test("renaming an unknown person reports that it does not exist", async () => {
	const run = await coordinator([call("rename", { person: "missing-worker", name: "New name" })]);
	try {
		await run.session.prompt("rename a missing worker");
		expect(toolResults(run)[0]).toMatchObject({
			isError: true,
			text: expect.stringContaining("no session has that id"),
		});
	} finally {
		await close(run);
	}
}, 20000);

test("hiring into a role the catalog lacks fails before any window opens", async () => {
	const run = await coordinator([call("hire", { cwd: workDir, role: "court-jester" })]);
	try {
		await run.session.prompt("hire a jester");
		expect(toolResults(run)[0]).toMatchObject({
			isError: true,
			text: expect.stringContaining('Unknown role \\"court-jester\\"'),
		});
	} finally {
		await close(run);
	}
}, 20000);

test("a hired person whose role does not manage loses the lifecycle tools; a hired manager keeps them", async () => {
	const tools = ["hire", "rehire", "send_home", "rename", "move", "let_go"];
	const run = await fauxSession(
		[bridge],
		[fauxAssistantMessage("ok"), fauxAssistantMessage("ok")],
		[...tools, "directory"],
	);
	try {
		run.session.extensionRunner.setFlagValue("reports-to", "boss");
		await withRole(run, "staff-engineer-simplicity");
		await run.session.prompt("hi");
		expect(run.session.getActiveToolNames().sort()).toEqual(
			["directory", "send_mail", "reply", "inbox", "read_thread", "post", "escalate", "update_self"].sort(),
		);
	} finally {
		await close(run);
	}
	const manager = await fauxSession([bridge], [fauxAssistantMessage("ok")], ["directory"]);
	try {
		manager.session.extensionRunner.setFlagValue("reports-to", "boss");
		await withRole(manager, "coordinator");
		await manager.session.prompt("hi");
		expect(manager.session.getActiveToolNames().sort()).toEqual(
			[...tools, "directory", "send_mail", "reply", "inbox", "read_thread", "post", "escalate", "update_self"].sort(),
		);
	} finally {
		await close(manager);
	}
}, 30000);

test.each([false, true])(
	"a root holds the manager tools whether or not its role manages, even when its initial tool set lacks them (role=%s)",
	async (enabled) => {
		const run = await fauxSession([bridge], [call("directory", {}), fauxAssistantMessage("done")], ["read"]);
		await withRole(run, enabled ? "coordinator" : undefined);
		try {
			await run.session.prompt("list my peers");
			expect(toolResults(run)[0]).toMatchObject({ isError: false });
			expect(run.session.getActiveToolNames().sort()).toEqual(
				[
					"read",
					"directory",
					"send_mail",
					"reply",
					"inbox",
					"read_thread",
					"post",
					"escalate",
					"hire",
					"rehire",
					"send_home",
					"rename",
					"move",
					"let_go",
					"update_self",
				].sort(),
			);
		} finally {
			await close(run);
		}
	},
	20000,
);

test.each([false, true])(
	"only a coordinator receives the coordinator charter (coordinator=%s)",
	async (enabled) => {
		const run = await fauxSession([bridge], [fauxAssistantMessage("ok")], []);
		await withRole(run, enabled ? "coordinator" : undefined);
		try {
			await run.session.prompt("hi");
			const prompt = run.session.agent.state.systemPrompt;
			if (enabled) expect(prompt).toContain("<role>\nYou are a coordinator");
			else expect(prompt).not.toContain("<role>");
			if (enabled) expect(prompt).toContain("<manager>\n");
			else expect(prompt).not.toContain("<manager>");
		} finally {
			await close(run);
		}
	},
	20000,
);

test("a hired person's soul and self reach the runtime, and the self follows the session through a restart", async () => {
	const self = "# The people I work with\n- The coordinator: terse, fair.";
	const run = await fauxSession(
		[bridge],
		[call("update_self", { text: self }), fauxAssistantMessage("written"), fauxAssistantMessage("back")],
		["read"],
	);
	const id = run.session.sessionManager.getSessionId();
	try {
		run.session.extensionRunner.setFlagValue("reports-to", "boss");
		await withRole(run, "repository-archaeologist");
		const facts = () =>
			query(state.dbPath, "select soul, self from sessions where id = ?", id)[0] as Record<string, unknown>;
		expect(facts()).toMatchObject({ soul: expect.stringMatching(/^You .+; habit: you .+\.$/), self: null });

		await run.session.prompt("write your self");
		expect(toolResults(run)[0]).toMatchObject({ isError: false });
		await vi.waitFor(() => expect(facts().self).toBe(self));

		// A new process of the same session (a rebind here) reports the self and soul its transcript holds.
		const { soul } = facts();
		await run.session.bindExtensions({});
		await run.session.prompt("back");
		expect(run.session.agent.state.systemPrompt).toContain(`<self>\n${self}\n</self>`);
		await vi.waitFor(() => expect(facts()).toEqual({ soul, self }));
	} finally {
		await close(run);
	}
}, 30000);
