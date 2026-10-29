import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test, vi } from "vitest";
import { sendCommand } from "../src/client.js";
import { openPeerProgram, type PeerProgram } from "../src/program-client.js";
import { migrate } from "../src/schema.js";
import { fakeBridge, query, runtimePid, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const fixture = new URL("../../../tests/fixtures/peer-pi.mjs", import.meta.url).pathname;
const processes: ReturnType<typeof standInProcess>[] = [];
let programs: PeerProgram[] = [];

afterEach(async () => {
	for (const program of programs) await program.close().catch(() => undefined);
	programs = [];
	for (const process of processes) process.child.kill();
	processes.length = 0;
	vi.unstubAllEnvs();
});

function hireCommand(manager: string, cwd: string) {
	return {
		kind: "start" as const,
		cwd,
		reportsTo: manager,
		role: "repository-archaeologist",
		name: "New Hire",
		goal: { text: "Record when this hire connects.", by: manager, title: "Hire date" },
	};
}

test("startup does not date an already applied hire or a person with no hire", async () => {
	const state = tempStateDir();
	mkdirSync(state.stateDir, { recursive: true });
	const db = new DatabaseSync(state.dbPath);
	migrate(db);
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, role, hired_at) values ('old-hire', 'root', '/tmp', 'idle', 1, 'fixture', 1, 'repository-archaeologist', null)",
	).run();
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, hired_at) values ('visitor', 'root', '/tmp', 'idle', 1, 'fixture', 1, null)",
	).run();
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, hired_at) values ('kept', 'root', '/tmp', 'idle', 1, 'fixture', 1, 5)",
	).run();
	db.prepare(
		"insert into incarnations (session_id, generation, pid, process_started_at, process_state, started_at, ended_at, source, updated_at) values ('old-hire', 1, 1, 1, 'exited', 20, 21, 'fixture', 21)",
	).run();
	db.prepare(
		"insert into commands (command_id, session_id, kind, command, stage, created_at, updated_at) values ('old-start', 'old-hire', 'start', ?, 'applied', 10, 20)",
	).run(
		JSON.stringify({
			kind: "start",
			role: "repository-archaeologist",
			goal: { text: "An old hire.", by: "someone", title: "Old" },
		}),
	);
	db.close();
	try {
		await startRuntime(state.socketPath);
		expect(query(state.dbPath, "select id, hired_at from sessions order by id")).toEqual([
			{ id: "kept", hired_at: 5 },
			{ id: "old-hire", hired_at: null },
			{ id: "visitor", hired_at: null },
		]);
	} finally {
		await stopRuntime(state);
	}
});

test("a connecting hire is dated once, and call-in, transfer, and restart keep that date", async () => {
	const state = tempStateDir();
	const bin = join(state.agentDir, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "pi"), `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, { mode: 0o700 });
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	const manager = standInProcess();
	const visitor = standInProcess();
	const lead = standInProcess();
	processes.push(manager, visitor, lead);
	await startRuntime(state.socketPath);
	try {
		await fakeBridge(state.socketPath, "manager", manager.pid, manager.startedAt, {
			session: { cwd: state.agentDir, name: "Manager" },
			facts: { manages: true },
		});
		await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = 'manager'")).toHaveLength(1));
		const hired = await sendCommand("new-hire", hireCommand("manager", state.agentDir), { commandId: "hire-command" });
		expect(hired.stage, hired.reason).toBe("applied");
		const dated = query<{ hired_at: number; started_at: number }>(
			state.dbPath,
			"select s.hired_at, min(i.started_at) as started_at from sessions s join incarnations i on i.session_id = s.id where s.id = 'new-hire'",
		)[0];
		expect(dated.hired_at).toBe(dated.started_at);

		await fakeBridge(state.socketPath, "visitor", visitor.pid, visitor.startedAt, {
			session: { cwd: state.agentDir, name: "Visitor" },
		});
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select hired_at from sessions where id = 'visitor'")).toEqual([{ hired_at: null }]),
		);
		const plain = await sendCommand("plain", {
			kind: "start",
			cwd: state.agentDir,
			reportsTo: "manager",
			goal: { text: "No role, so this is not a hire.", by: "manager", title: "Unroled" },
		});
		expect(plain.stage, plain.reason).toBe("applied");
		expect(query(state.dbPath, "select hired_at from sessions where id = 'plain'")).toEqual([{ hired_at: null }]);

		const repeat = await sendCommand("new-hire", hireCommand("manager", state.agentDir), { commandId: "hire-command" });
		expect(repeat.stage).toBe("applied");
		expect(query(state.dbPath, "select hired_at from sessions where id = 'new-hire'")).toEqual([
			{ hired_at: dated.hired_at },
		]);

		const pid = query<{ pid: number }>(
			state.dbPath,
			"select pid from incarnations where session_id = 'new-hire' and ended_at is null",
		)[0].pid;
		process.kill(pid, "SIGTERM");
		await vi.waitFor(() =>
			expect(
				query(state.dbPath, "select ended_at from incarnations where session_id = 'new-hire' and pid = ?", pid)[0]
					.ended_at,
			).not.toBeNull(),
		);
		const called = await sendCommand("new-hire", { kind: "start", reportsTo: "manager" });
		expect(called.stage, called.reason).toBe("applied");
		expect(query(state.dbPath, "select hired_at from sessions where id = 'new-hire'")).toEqual([
			{ hired_at: dated.hired_at },
		]);

		await fakeBridge(state.socketPath, "lead", lead.pid, lead.startedAt, {
			session: { cwd: state.agentDir, name: "Lead" },
			facts: { reportsTo: "manager", manages: true },
		});
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select reports_to from sessions where id = 'lead'")).toEqual([
				{ reports_to: "manager" },
			]),
		);
		const moved = await sendCommand("new-hire", { kind: "transfer", manager: "lead", by: "manager" });
		expect(moved.stage, moved.reason).toBe("applied");
		expect(query(state.dbPath, "select reports_to, hired_at from sessions where id = 'new-hire'")).toEqual([
			{ reports_to: "lead", hired_at: dated.hired_at },
		]);

		const runtime = runtimePid(state.pidPath)!;
		process.kill(runtime, "SIGTERM");
		await vi.waitFor(() => expect(existsSync(state.socketPath)).toBe(false));
		await startRuntime(state.socketPath);
		expect(query(state.dbPath, "select hired_at from sessions where id = 'new-hire'")).toEqual([
			{ hired_at: dated.hired_at },
		]);
		expect(query(state.dbPath, "select hired_at from sessions where id = 'visitor'")).toEqual([{ hired_at: null }]);
	} finally {
		await stopRuntime(state);
	}
}, 40000);

test("a start that exits before connecting leaves no hire date, and calling in does not add one", async () => {
	const state = tempStateDir();
	const bin = join(state.agentDir, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "pi"), `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, { mode: 0o700 });
	writeFileSync(join(state.agentDir, "peer-control.json"), JSON.stringify({ failStartup: true }));
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	const manager = standInProcess();
	processes.push(manager);
	await startRuntime(state.socketPath);
	try {
		await fakeBridge(state.socketPath, "manager", manager.pid, manager.startedAt, {
			session: { cwd: state.agentDir },
			facts: { manages: true },
		});
		await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = 'manager'")).toHaveLength(1));
		const failed = await sendCommand("missed", hireCommand("manager", state.agentDir));
		expect(failed.stage).toBe("failed");
		expect(query(state.dbPath, "select hired_at from sessions where id = 'missed'")).toEqual([{ hired_at: null }]);
		writeFileSync(join(state.agentDir, "peer-control.json"), "{}");
		const called = await sendCommand("missed", { kind: "start", reportsTo: "manager" });
		expect(called.stage, called.reason).toBe("applied");
		expect(query(state.dbPath, "select hired_at from sessions where id = 'missed'")).toEqual([{ hired_at: null }]);
	} finally {
		await stopRuntime(state);
	}
}, 40000);

test("a program peer is not given a hire date", async () => {
	const state = tempStateDir();
	const bin = join(state.agentDir, "bin");
	mkdirSync(bin);
	writeFileSync(join(bin, "pi"), `#!/bin/sh\nexec '${process.execPath}' '${fixture}' "$@"\n`, { mode: 0o700 });
	vi.stubEnv("PATH", `${bin}:${process.env.PATH}`);
	const manager = standInProcess();
	processes.push(manager);
	await startRuntime(state.socketPath);
	try {
		await fakeBridge(state.socketPath, "caller", manager.pid, manager.startedAt, {
			session: { cwd: state.agentDir },
			facts: { manages: true },
		});
		await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = 'caller'")).toHaveLength(1));
		const program = await openPeerProgram("caller");
		programs.push(program);
		const started = await program.command("peer-1", {
			kind: "start",
			role: "implementation-engineer",
			goal: { by: "caller", text: "A temporary peer is not a hire." },
		});
		expect(started.stage, started.reason).toBe("applied");
		expect(query(state.dbPath, "select hired_at from sessions where id = 'peer-1'")).toEqual([{ hired_at: null }]);
	} finally {
		await stopRuntime(state);
	}
}, 40000);
