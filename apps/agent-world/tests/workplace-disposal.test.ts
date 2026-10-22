import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { expect, test, vi } from "vitest";
import { discardProgramPeople } from "../../../components/session-state/src/program-peers.js";
import {
	fakeBridge,
	query,
	sendCommand,
	standInProcess,
	startRuntime,
	stopRuntime,
	tempStateDir,
} from "../../../components/session-state/tests/helpers.js";
import { openWorldBackend } from "../src/backend/world-backend.js";

test("disposal removes a cached sleeper and refreshes its lasting report's manager without a full world reread", async () => {
	const state = tempStateDir();
	const leadProcess = standInProcess();
	const temporaryProcess = standInProcess();
	await startRuntime(state.socketPath);
	const lead = await fakeBridge(state.socketPath, "lead", leadProcess.pid, leadProcess.startedAt, {
		facts: { manages: true },
	});
	const temporary = await fakeBridge(state.socketPath, "temporary", temporaryProcess.pid, temporaryProcess.startedAt, {
		facts: { reportsTo: "lead", manages: true },
	});
	const lasting = await fakeBridge(state.socketPath, "lasting", leadProcess.pid, leadProcess.startedAt, {
		facts: { reportsTo: "temporary" },
	});
	const world = openWorldBackend({ db: state.dbPath, socket: state.socketPath });
	try {
		await vi.waitFor(() => expect(world.snapshot().characters).toHaveLength(3), { timeout: 10000 });
		expect(
			(
				await sendCommand(state.socketPath, "temporary", {
					kind: "work",
					action: "take",
					goal: "A temporary check",
					cwd: state.agentDir,
				})
			).at(-1)?.stage,
		).toBe("applied");
		for (const link of [temporary, lasting]) link.send({ type: "shutdown", reason: "quit" });
		const exited = once(temporaryProcess.child, "exit");
		temporaryProcess.child.kill();
		await exited;
		await vi.waitFor(
			() =>
				expect(
					world
						.snapshot()
						.dormant?.map((person) => person.id)
						.sort(),
				).toEqual(["lasting", "temporary"]),
			{ timeout: 10000 },
		);
		// Seed the ownership journal, then use the production cleanup transaction after the process has gone.
		const db = new DatabaseSync(state.dbPath);
		try {
			const task = query<{ task_id: string }>(
				state.dbPath,
				"select task_id from work_focus where person = 'temporary'",
			)[0];
			db.prepare("insert into program_scopes (id, caller) values ('scope', 'lead')").run();
			db.prepare(
				"insert into program_peers (session_id, program_id, created_by, task_id) values ('temporary', 'scope', 'lead', ?)",
			).run(task.task_id);
			discardProgramPeople(db, state.stateDir, new Set(["temporary"]), Date.now());
		} finally {
			db.close();
		}
		expect(query(state.dbPath, "select id from sessions where id = 'temporary'")).toEqual([]);
		await vi.waitFor(
			() => {
				expect(world.snapshot().dormant?.map((person) => person.id)).toEqual(["lasting"]);
				expect(world.snapshot().dormant?.[0].reportsTo).toBe("lead");
				expect(world.snapshot().workplace?.tasks).toEqual([]);
			},
			{ timeout: 3000 },
		);
	} finally {
		world.close();
		for (const link of [lead, temporary, lasting]) link.socket.destroy();
		leadProcess.child.kill();
		temporaryProcess.child.kill();
		await stopRuntime(state);
	}
}, 25000);
