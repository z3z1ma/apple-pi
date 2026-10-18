import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fakeBridge, query, standInProcess, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
beforeAll(() => startRuntime(state.socketPath));
afterAll(() => stopRuntime(state));

const incarnations = (id: string) =>
	query(
		state.dbPath,
		"select generation, process_state, end_reason from incarnations where session_id = ? order by generation",
		id,
	);

test("a bridge whose connection drops while its process lives is alive with the bridge lost", async () => {
	const proc = standInProcess();
	try {
		const bridge = await fakeBridge(state.socketPath, "dropped", proc.pid, proc.startedAt);
		await vi.waitFor(() =>
			expect(incarnations("dropped")).toEqual([{ generation: 1, process_state: "alive", end_reason: null }]),
		);
		bridge.socket.destroy();
		await vi.waitFor(() =>
			expect(incarnations("dropped")).toEqual([
				{ generation: 1, process_state: "alive_bridge_lost", end_reason: null },
			]),
		);
	} finally {
		proc.child.kill();
	}
});

test("a bridge that stops heartbeating on an open connection is alive with the bridge lost, then lost when its process dies", async () => {
	const proc = standInProcess();
	const bridge = await fakeBridge(state.socketPath, "silent", proc.pid, proc.startedAt);
	try {
		await vi.waitFor(() =>
			expect(incarnations("silent")).toEqual([{ generation: 1, process_state: "alive", end_reason: null }]),
		);
		await vi.waitFor(
			() =>
				expect(incarnations("silent")).toEqual([
					{ generation: 1, process_state: "alive_bridge_lost", end_reason: null },
				]),
			{ timeout: 10000 },
		);
		proc.child.kill();
		await vi.waitFor(
			() =>
				expect(incarnations("silent")).toEqual([{ generation: 1, process_state: "lost", end_reason: "process gone" }]),
			{ timeout: 5000 },
		);
	} finally {
		bridge.socket.destroy();
		proc.child.kill();
	}
}, 20000);

test("a superseded incarnation whose process still runs stays tracked until the process dies, then is lost", async () => {
	const old = standInProcess();
	const fresh = standInProcess();
	try {
		const first = await fakeBridge(state.socketPath, "overlap", old.pid, old.startedAt);
		await vi.waitFor(() => expect(incarnations("overlap")).toHaveLength(1));
		first.socket.destroy();
		await fakeBridge(state.socketPath, "overlap", fresh.pid, fresh.startedAt);
		await vi.waitFor(() =>
			expect(incarnations("overlap")).toEqual([
				{ generation: 1, process_state: "alive_bridge_lost", end_reason: "superseded" },
				{ generation: 2, process_state: "alive", end_reason: null },
			]),
		);
		old.child.kill();
		await vi.waitFor(
			() =>
				expect(incarnations("overlap")[0]).toEqual({ generation: 1, process_state: "lost", end_reason: "superseded" }),
			{ timeout: 5000 },
		);
	} finally {
		old.child.kill();
		fresh.child.kill();
	}
});

test("a superseded bridge's activity does not change the current generation's run state", async () => {
	const old = standInProcess();
	const fresh = standInProcess();
	try {
		const first = await fakeBridge(state.socketPath, "stale", old.pid, old.startedAt);
		await vi.waitFor(() => expect(incarnations("stale")).toHaveLength(1));
		const second = await fakeBridge(state.socketPath, "stale", fresh.pid, fresh.startedAt);
		second.send({ type: "run", run: "thinking" });
		await vi.waitFor(() =>
			expect(query(state.dbPath, "select run_state, generation from sessions where id = 'stale'")).toEqual([
				{ run_state: "thinking", generation: 2 },
			]),
		);
		first.send({ type: "run", run: "running_tool" });
		first.send({ type: "shutdown", reason: "quit" });
		await new Promise((resolve) => setTimeout(resolve, 300));
		expect(query(state.dbPath, "select run_state, generation from sessions where id = 'stale'")).toEqual([
			{ run_state: "thinking", generation: 2 },
		]);
		first.socket.destroy();
		second.socket.destroy();
	} finally {
		old.child.kill();
		fresh.child.kill();
	}
});

test("the same session from a new process is generation 2, and generation 1 ends", async () => {
	const old = standInProcess();
	const fresh = standInProcess();
	try {
		const first = await fakeBridge(state.socketPath, "reopened", old.pid, old.startedAt);
		await vi.waitFor(() => expect(incarnations("reopened")).toHaveLength(1));
		old.child.kill();
		first.socket.destroy();
		await fakeBridge(state.socketPath, "reopened", fresh.pid, fresh.startedAt);
		await vi.waitFor(() =>
			expect(incarnations("reopened")).toEqual([
				{ generation: 1, process_state: "lost", end_reason: expect.any(String) },
				{ generation: 2, process_state: "alive", end_reason: null },
			]),
		);
	} finally {
		old.child.kill();
		fresh.child.kill();
	}
});
