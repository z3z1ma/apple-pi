import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { Runtime } from "../src/runtime.js";
import { migrate } from "../src/schema.js";
import { fakeBridge, query, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
beforeAll(() => startRuntime(state.socketPath));
afterAll(() => stopRuntime(state));

test("spend a session already had when the runtime first hears of it is marked as a baseline; later spend is not", async () => {
	const proc = standInProcess();
	try {
		const bridge = await fakeBridge(state.socketPath, "veteran", proc.pid, proc.startedAt, { facts: { cost: 12 } });
		const costs = () =>
			query<{ data: string }>(
				state.dbPath,
				"select data from events where session_id = 'veteran' and type = 'cost_changed' order by seq",
			).map((row) => JSON.parse(row.data));
		await vi.waitFor(() => expect(costs()).toEqual([{ from: 0, to: 12, hello: true }]));
		bridge.send({ type: "facts", facts: { cost: 15 } });
		await vi.waitFor(() =>
			expect(costs()).toEqual([
				{ from: 0, to: 12, hello: true },
				{ from: 12, to: 15 },
			]),
		);
		bridge.socket.destroy();
		// A reconnect after an outage reports spend made while the runtime was away: real spend, not a baseline.
		const again = await fakeBridge(state.socketPath, "veteran", proc.pid, proc.startedAt, { facts: { cost: 20 } });
		await vi.waitFor(() => expect(costs().at(-1)).toEqual({ from: 15, to: 20 }));
		again.socket.destroy();
	} finally {
		proc.child.kill();
	}
}, 20000);

test("a session whose row exists before any cost was recorded still takes its first hello cost as a baseline", async () => {
	const proc = standInProcess();
	try {
		const first = await fakeBridge(state.socketPath, "provisional", proc.pid, proc.startedAt);
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select 1 from sessions where id = 'provisional'")).toHaveLength(1),
		);
		first.socket.destroy();
		const second = await fakeBridge(state.socketPath, "provisional", proc.pid, proc.startedAt, { facts: { cost: 12 } });
		const costs = () =>
			query<{ data: string }>(
				state.dbPath,
				"select data from events where session_id = 'provisional' and type = 'cost_changed' order by seq",
			).map((row) => JSON.parse(row.data));
		await vi.waitFor(() => expect(costs()).toEqual([{ from: 0, to: 12, hello: true }]));
		second.send({ type: "facts", facts: { cost: 15 } });
		await vi.waitFor(() => expect(costs().at(-1)).toEqual({ from: 12, to: 15 }));
		second.socket.destroy();
	} finally {
		proc.child.kill();
	}
}, 20000);

test("a fact change and its event commit together: a crash before the event leaves the snapshot unchanged", () => {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at) values ('joining', 'root', '/', 'idle', 1, 'test', 0)",
	).run();
	const runtime = Object.create(Runtime.prototype) as {
		db: DatabaseSync;
		event: () => void;
		applyFacts: (id: string, generation: number, facts: Record<string, unknown>) => void;
	};
	runtime.db = db;
	runtime.event = () => {
		throw new Error("the process died here");
	};
	expect(() => runtime.applyFacts("joining", 1, { reportsTo: "root", cost: 5 })).toThrow("the process died here");
	expect(db.prepare("select reports_to, cost from sessions where id = 'joining'").get()).toEqual({
		reports_to: null,
		cost: 0,
	});
	expect(db.isTransaction).toBe(false);
});
