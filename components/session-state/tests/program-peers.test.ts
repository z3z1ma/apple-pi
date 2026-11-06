import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ROLE_ENTRY } from "../../organization/src/session-role.js";
import { comparePrograms } from "../../programs/src/compare.js";
import { runAgent } from "../../programs/src/peers.js";
import { sendCommand } from "../src/client.js";
import { statePaths } from "../src/paths.js";
import { openPeerProgram, type PeerProgram } from "../src/program-client.js";
import { fakeBridge, query, runtimePid, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

let state: ReturnType<typeof tempStateDir>;
let parent: ReturnType<typeof standInProcess>;
let caller: Awaited<ReturnType<typeof fakeBridge>>;
let boss: Awaited<ReturnType<typeof fakeBridge>>;
let programs: PeerProgram[];
let tmuxSocket: string | undefined;
const fixture = new URL("../../../tests/fixtures/peer-pi.mjs", import.meta.url).pathname;

beforeEach(async () => {
	state = tempStateDir();
	programs = [];
	tmuxSocket = undefined;
	const bin = join(state.agentDir, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "pi"), `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, { mode: 0o700 });
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	await startRuntime(state.socketPath);
	parent = standInProcess();
	boss = await fakeBridge(state.socketPath, "boss", parent.pid, parent.startedAt, {
		session: { cwd: state.agentDir },
		facts: { manages: true },
	});
	caller = await fakeBridge(state.socketPath, "caller", parent.pid, parent.startedAt, {
		session: { cwd: state.agentDir },
		facts: { reportsTo: "boss", manages: false },
	});
	await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions")).toHaveLength(2));
});

afterEach(async () => {
	await Promise.allSettled(programs.map((program) => program.close()));
	caller?.socket.destroy();
	boss?.socket.destroy();
	parent?.child.kill();
	if (tmuxSocket) {
		try {
			execFileSync("tmux", ["-S", tmuxSocket, "kill-server"], { timeout: 5000, stdio: "ignore" });
		} catch {}
	}
	await stopRuntime(state);
	vi.unstubAllEnvs();
});

test("an explicit runtime keeps program ownership and command identities independent of ambient state", async () => {
	const paths = statePaths();
	const elsewhere = tempStateDir();
	try {
		const program = await openPeerProgram("caller", undefined, { paths, id: "durable-attempt-scope" });
		programs.push(program);
		expect(program.id).toBe("durable-attempt-scope");
		const person = await createPeer(program);
		const receipt = await program.command(
			person,
			{ kind: "run_turn", task: "Inspect the source." },
			{ commandId: "durable-attempt-turn" },
		);
		expect(receipt).toMatchObject({ commandId: "durable-attempt-turn", stage: "applied" });
		await program.close();
		cleanOwnership();
		expect(existsSync(elsewhere.dbPath)).toBe(false);
	} finally {
		await stopRuntime(elsewhere);
	}
});

async function programFor(person = "caller") {
	const program = await openPeerProgram(person);
	programs.push(program);
	return program;
}

async function createPeer(program: PeerProgram, role = "implementation-engineer") {
	const id = randomUUID();
	const receipt = await program.command(id, {
		kind: "start",
		role,
		goal: { by: "caller", text: "Verify the assigned change and state what you believe." },
	});
	expect(receipt.stage, receipt.reason).toBe("applied");
	return id;
}

function commandsOf(id: string) {
	return readFileSync(join(state.agentDir, "peer-records", `${id}.commands.jsonl`), "utf8")
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line).command);
}

function processGone(pid: number) {
	try {
		process.kill(pid, 0);
		return false;
	} catch {
		return true;
	}
}

function cleanOwnership() {
	expect(query(state.dbPath, "select * from program_peers")).toEqual([]);
	expect(query(state.dbPath, "select * from program_scopes")).toEqual([]);
	expect(query(state.dbPath, "select id from sessions order by id")).toEqual([{ id: "boss" }, { id: "caller" }]);
	expect(query(state.dbPath, "select * from work_tasks")).toEqual([]);
	expect(query(state.dbPath, "select * from assignments")).toEqual([]);
	expect(existsSync(join(state.stateDir, "tasks")) ? readdirSync(join(state.stateDir, "tasks")) : []).toEqual([]);
	expect(processGone(parent.pid)).toBe(false);
}

async function callerInTmux(): Promise<string> {
	tmuxSocket = join(state.agentDir, "program.sock");
	execFileSync("tmux", ["-S", tmuxSocket, "-f", "/dev/null", "new-session", "-d", "-s", "program", "sleep 600"], {
		timeout: 5000,
	});
	tmuxSocket = realpathSync(tmuxSocket);
	const pane = execFileSync("tmux", ["-S", tmuxSocket, "display-message", "-p", "#{pane_id}"], {
		timeout: 5000,
		encoding: "utf8",
	}).trim();
	caller.socket.end(`${JSON.stringify({ type: "shutdown", reason: "quit" })}\n`);
	await vi.waitFor(() =>
		expect(
			query(state.dbPath, "select 1 from incarnations where session_id = 'caller' and ended_at is not null"),
		).toHaveLength(1),
	);
	const socket = createConnection(state.socketPath);
	await new Promise<void>((resolve) => socket.once("connect", resolve));
	caller = { socket, send: (message) => socket.write(`${JSON.stringify(message)}\n`) };
	caller.send({
		type: "hello",
		session: { id: "caller", kind: "root", cwd: state.agentDir },
		process: { pid: parent.pid, startedAt: parent.startedAt },
		tmux: { socket: tmuxSocket, pane },
		run: "idle",
		facts: { reportsTo: "boss", manages: false },
	});
	await vi.waitFor(() =>
		expect(
			query(state.dbPath, "select 1 from incarnations where session_id = 'caller' and tmux_socket = ?", tmuxSocket!),
		).toHaveLength(1),
	);
	return pane;
}

test("an ordinary non-manager can run a headless role peer; closing waits for its process and removes its task but keeps its transcript", async () => {
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ exitDelay: 80 }));
	const program = await programFor();
	const id = await createPeer(program);
	const launch = JSON.parse(readFileSync(join(state.agentDir, "peer-records", `${id}.launch.json`), "utf8"));
	expect(launch.args).toEqual(
		expect.arrayContaining(["--mode", "rpc", "--role", "implementation-engineer", "--reports-to", "caller"]),
	);
	expect(launch.program).toBe(program.id);
	expect(launch.parent).toBe("caller");
	const result = await program.command(id, { kind: "run_turn", task: "Report the result." });
	expect(result.result?.text).toBe("Reply from implementation-engineer: Report the result.");
	expect(commandsOf(id).some((command) => command.kind === "steer")).toBe(false);
	expect(query(state.dbPath, "select settled_at, needs_you_since from sessions where id = ?", id)).toEqual([
		{ settled_at: expect.any(Number), needs_you_since: null },
	]);
	await program.close();
	expect(processGone(launch.pid)).toBe(true);
	expect(readFileSync(join(state.agentDir, "peer-records", `${id}.stopped`), "utf8")).toBe("graceful shutdown");
	cleanOwnership();
	expect(readFileSync(join(state.agentDir, "peer-records", `${id}.jsonl`), "utf8")).toContain("Report the result.");
});

test("a peer started in a directory the program chose runs there headless and trusts it", async () => {
	const directory = realpathSync(mkdtempSync(join(tmpdir(), "aps-peer-cwd-")));
	const program = await programFor();
	const id = randomUUID();
	const receipt = await program.command(id, {
		kind: "start",
		role: "implementation-engineer",
		cwd: directory,
		goal: { by: "caller", text: "Work in the chosen copy." },
	});
	expect(receipt.stage, receipt.reason).toBe("applied");
	const launch = JSON.parse(readFileSync(join(state.agentDir, "peer-records", `${id}.launch.json`), "utf8"));
	expect(launch.args).toEqual(expect.arrayContaining(["--mode", "rpc", "--approve"]));
	expect(query(state.dbPath, "select cwd from sessions where id = ?", id)).toEqual([{ cwd: directory }]);
	await program.close();
	rmSync(directory, { recursive: true, force: true });
});

test("a program comparison runs each task in fresh worktrees, with the program only in its arm, and checks each copy", async () => {
	const repo = realpathSync(mkdtempSync(join(tmpdir(), "aps-compare-")));
	const run = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
	run("init", "-q");
	writeFileSync(join(repo, "README.md"), "fixture\n");
	run("add", "README.md");
	run("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
	const samples = await comparePrograms("caller", {
		root: repo,
		name: "probe",
		source: '// @program: {"description": "Probe."}\nreturn 1;\n',
		base: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
		role: "implementation-engineer",
		tasks: [{ task: "Report the result.", check: "test -f .pi/programs/probe.js" }],
		samples: 3,
	});
	expect(samples.map((sample) => sample.arm)).toEqual(["with", "without", "without", "with", "with", "without"]);
	expect(samples.map((sample) => [sample.arm, sample.completed, sample.correct])).toEqual(
		samples.map((sample) => [sample.arm, true, sample.arm === "with"]),
	);
	expect(execFileSync("git", ["worktree", "list"], { cwd: repo, encoding: "utf8" }).trim().split("\n")).toHaveLength(1);
	cleanOwnership();
	rmSync(repo, { recursive: true, force: true });
}, 120_000);

test("aborting a comparison during its last check ends it as aborted and removes the worktree", async () => {
	const repo = realpathSync(mkdtempSync(join(tmpdir(), "aps-compare-abort-")));
	const run = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "pipe" });
	run("init", "-q");
	writeFileSync(join(repo, "README.md"), "fixture\n");
	run("add", "README.md");
	run("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "base");
	const marker = join(repo, "..", `${randomUUID()}.checking`);
	const stop = new AbortController();
	const watching = setInterval(() => {
		if (existsSync(marker)) stop.abort(new Error("stopped by the operator"));
	}, 50);
	try {
		await expect(
			comparePrograms(
				"caller",
				{
					root: repo,
					name: "probe",
					source: '// @program: {"description": "Probe."}\nreturn 1;\n',
					base: execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim(),
					role: "implementation-engineer",
					tasks: [{ task: "Report the result.", check: `touch '${marker}'; sleep 30` }],
					samples: 1,
				},
				stop.signal,
			),
		).rejects.toThrow("stopped by the operator");
	} finally {
		clearInterval(watching);
	}
	expect(execFileSync("git", ["worktree", "list"], { cwd: repo, encoding: "utf8" }).trim().split("\n")).toHaveLength(1);
	cleanOwnership();
	rmSync(repo, { recursive: true, force: true });
	rmSync(marker, { force: true });
}, 60_000);

test("a peer started without a directory gets the caller's and no trust override", async () => {
	const program = await programFor();
	const id = await createPeer(program);
	const launch = JSON.parse(readFileSync(join(state.agentDir, "peer-records", `${id}.launch.json`), "utf8"));
	expect(launch.args).not.toContain("--approve");
	await program.close();
});

test("closing a peer that exits on SIGTERM also stops the detached process it left behind", async () => {
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ detachedChild: true }));
	const program = await programFor();
	const id = await createPeer(program);
	const child = Number(readFileSync(join(state.agentDir, "peer-records", `${id}.child`), "utf8"));
	await program.close();
	await vi.waitFor(() => expect(processGone(child)).toBe(true));
	cleanOwnership();
}, 90_000);

test("closing a reviewer that ignores SIGTERM and its closed input kills it after the grace period", async () => {
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ unresponsive: true, detachedChild: true }));
	const program = await programFor();
	const id = await createPeer(program);
	const launch = JSON.parse(readFileSync(join(state.agentDir, "peer-records", `${id}.launch.json`), "utf8"));
	const child = Number(readFileSync(join(state.agentDir, "peer-records", `${id}.child`), "utf8"));
	const started = Date.now();
	await program.close();
	expect(Date.now() - started).toBeGreaterThanOrEqual(30_000);
	expect(processGone(launch.pid)).toBe(true);
	await vi.waitFor(() => expect(processGone(child)).toBe(true));
	expect(existsSync(join(state.agentDir, "peer-records", `${id}.stopped`))).toBe(false);
	cleanOwnership();
}, 90_000);

test("an attached lasting person runs in its own session and is never owned or closed by the program", async () => {
	const id = randomUUID();
	const started = await sendCommand(id, {
		kind: "start",
		cwd: state.agentDir,
		reportsTo: "boss",
		role: "implementation-engineer",
		goal: { by: "boss", text: "Keep working on this lasting assignment." },
	});
	expect(started.stage, started.reason).toBe("applied");
	const program = await programFor();
	const result = await program.command(id, { kind: "run_turn", task: "Give a second opinion." });
	expect(result.result?.text).toContain("Give a second opinion.");
	expect(commandsOf(id)).toContainEqual({
		kind: "steer",
		text: "You have assigned work. Begin with your focused task.",
	});
	expect((await program.command(id, { kind: "discard_peer" })).stage).toBe("failed");
	const manager = await createPeer(program, "team-lead");
	const moved = await sendCommand(id, { kind: "transfer", manager, by: "boss" });
	expect(moved.stage, moved.reason).toBe("applied");
	const held = program.command(id, { kind: "run_turn", task: "hold this request until it is cancelled" });
	await vi.waitFor(() =>
		expect(
			query(
				state.dbPath,
				"select 1 from commands where session_id = ? and kind = 'run_turn' and stage = 'delivered'",
				id,
			),
		).toHaveLength(1),
	);
	await program.close();
	expect((await held).stage).toBe("failed");
	expect(query(state.dbPath, "select reports_to from sessions where id = ?", id)).toEqual([{ reports_to: "caller" }]);
	expect(query(state.dbPath, "select id from sessions where id = ?", id)).toHaveLength(1);
	expect(query(state.dbPath, "select process_state from incarnations where session_id = ?", id)).toEqual([
		{ process_state: "alive" },
	]);
	expect(query(state.dbPath, "select * from program_peers")).toEqual([]);
	expect(query(state.dbPath, "select * from work_tasks")).toHaveLength(1);
});

test("closing a temporary person also cleans its nested program after a reporting transfer", async () => {
	const program = await programFor();
	const manager = await createPeer(program, "team-lead");
	const nested = await programFor(manager);
	const child = await createPeer(nested);
	const moved = await sendCommand(child, { kind: "transfer", manager: "boss", by: "boss" });
	expect(moved.stage, moved.reason).toBe("applied");
	const receipt = await program.command(manager, { kind: "discard_peer" });
	expect(receipt.stage, receipt.reason).toBe("applied");
	expect(query(state.dbPath, "select * from program_peers")).toEqual([]);
	expect(query(state.dbPath, "select id from program_scopes")).toEqual([{ id: program.id }]);
	await nested.close();
	await program.close();
	cleanOwnership();
});

test("a process that fails before hello leaves no person or assignment after program cleanup", async () => {
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ failStartup: true }));
	const program = await programFor();
	const receipt = await program.command(randomUUID(), {
		kind: "start",
		role: "implementation-engineer",
		goal: { by: "caller", text: "An unstarted goal." },
	});
	expect(receipt.stage).toBe("failed");
	expect(receipt.reason).toContain("before connecting");
	await program.close();
	cleanOwnership();
});

test("a task shared with a lasting person survives its temporary colleague", async () => {
	const program = await programFor();
	const id = await createPeer(program);
	const task = query<{ id: string; bundle: string }>(state.dbPath, "select id, bundle from work_tasks")[0]!;
	const assigned = await sendCommand("boss", {
		kind: "work",
		action: "assign",
		person: "boss",
		task: task.id,
		cwd: state.agentDir,
	});
	expect(assigned.stage, assigned.reason).toBe("applied");
	await program.close();
	expect(existsSync(join(task.bundle, "task.md"))).toBe(true);
	expect(query(state.dbPath, "select person from assignments where ended_at is null")).toEqual([{ person: "boss" }]);
	expect(query(state.dbPath, "select id from sessions where id = ?", id)).toEqual([]);
});

test("a promoted ledger task survives the program that created it", async () => {
	const program = await programFor();
	const id = await createPeer(program);
	const task = query<{ id: string }>(state.dbPath, "select id from work_tasks")[0]!;
	const kept = await sendCommand(id, { kind: "work", action: "promote", task: task.id, cwd: state.agentDir });
	expect(kept.stage, kept.reason).toBe("applied");
	const promoted = query<{ bundle: string; ephemeral: number }>(
		state.dbPath,
		"select bundle, ephemeral from work_tasks",
	)[0]!;
	expect(promoted.ephemeral).toBe(0);
	await program.close();
	expect(existsSync(join(promoted.bundle, "task.md"))).toBe(true);
	expect(query(state.dbPath, "select * from work_tasks")).toHaveLength(1);
	expect(query(state.dbPath, "select id from sessions where id = ?", id)).toEqual([]);
});

test("cancellation before hello still waits for the launched process and removes its unstarted assignment", async () => {
	writeFileSync(
		join(state.agentDir, "peer-control.json"),
		JSON.stringify({ helloGate: join(state.agentDir, "never-opened"), exitDelay: 80 }),
	);
	const program = await programFor();
	const id = randomUUID();
	const abort = new AbortController();
	const started = program.command(
		id,
		{ kind: "start", role: "implementation-engineer", goal: { by: "caller", text: "Do not get as far as this goal." } },
		{ signal: abort.signal },
	);
	const rejected = expect(started).rejects.toThrow("Cancelled startup");
	const record = join(state.agentDir, "peer-records", `${id}.launch.json`);
	await vi.waitFor(() => expect(existsSync(record)).toBe(true));
	abort.abort(new Error("Cancelled startup"));
	await rejected;
	await program.close();
	expect(processGone(JSON.parse(readFileSync(record, "utf8")).pid)).toBe(true);
	cleanOwnership();
});

test("a caller can confirm cleanup after a runtime crash without losing the peer transcript", async () => {
	const program = await programFor();
	const id = await createPeer(program);
	const pid = JSON.parse(readFileSync(join(state.agentDir, "peer-records", `${id}.launch.json`), "utf8")).pid;
	process.kill(runtimePid(state.pidPath)!, "SIGKILL");
	await program.close();
	expect(processGone(pid)).toBe(true);
	cleanOwnership();
	expect(existsSync(join(state.agentDir, "peer-records", `${id}.jsonl`))).toBe(true);
}, 15000);

test("ten one-shot agent calls automatically leave one caller pane, no former people and no temporary task bundles", async () => {
	const pane = await callerInTmux();
	const ctx = {
		cwd: state.agentDir,
		sessionManager: {
			getSessionId: () => "caller",
			getEntries: () => [{ type: "custom", customType: ROLE_ENTRY, data: { role: "coordinator" } }],
		},
	} as never;
	for (let i = 0; i < 10; i++) {
		const result = await runAgent(ctx, { role: "implementation-engineer", task: `Verify iteration ${i}.` });
		expect(result.structuredContent.status).toBe("completed");
		const panes = execFileSync("tmux", ["-S", tmuxSocket!, "list-panes", "-a", "-F", "#{pane_id}"], {
			timeout: 5000,
			encoding: "utf8",
		})
			.trim()
			.split("\n");
		expect(panes).toEqual([pane]);
		expect(query(state.dbPath, "select * from program_peers")).toEqual([]);
	}
	cleanOwnership();
}, 30000);

test("restart finds a renamed window even when the launch died before recording its pane or receiving hello", async () => {
	await callerInTmux();
	writeFileSync(
		join(state.agentDir, "peer-control.json"),
		JSON.stringify({ helloGate: join(state.agentDir, "never-opened") }),
	);
	const program = await programFor();
	const id = randomUUID();
	const started = program.command(id, {
		kind: "start",
		role: "implementation-engineer",
		goal: { by: "caller", text: "Recover this launch." },
	});
	const interrupted = expect(started).rejects.toThrow("runtime connection");
	const record = join(state.agentDir, "peer-records", `${id}.launch.json`);
	await vi.waitFor(() => expect(existsSync(record)).toBe(true));
	const { pid } = JSON.parse(readFileSync(record, "utf8"));
	const panes = execFileSync("tmux", ["-S", tmuxSocket!, "list-panes", "-a", "-F", "#{pane_id} #{pane_pid}"], {
		timeout: 5000,
		encoding: "utf8",
	});
	const pane = panes
		.split("\n")
		.find((line) => line.endsWith(` ${pid}`))!
		.split(" ")[0]!;
	execFileSync("tmux", ["-S", tmuxSocket!, "rename-window", "-t", pane, "A human name"], { timeout: 5000 });
	const daemon = runtimePid(state.pidPath)!;
	process.kill(daemon, "SIGKILL");
	await interrupted;
	await vi.waitFor(() => expect(processGone(daemon)).toBe(true));
	const db = new DatabaseSync(state.dbPath);
	try {
		db.prepare("update program_peers set pane = null where session_id = ?").run(id);
	} finally {
		db.close();
	}
	await program.close();
	expect(processGone(pid)).toBe(true);
	cleanOwnership();
}, 15000);
