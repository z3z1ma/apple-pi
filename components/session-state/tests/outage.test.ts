import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import bridge from "../src/index.js";
import { close, query, runtimePid, startRuntime, stopRuntime, tempStateDir } from "./helpers.js";

const state = tempStateDir();
beforeAll(() => startRuntime(state.socketPath));
afterAll(() => stopRuntime(state));

type Row = Record<string, unknown>;

test("a session keeps working through a runtime outage, its state comes back, and the outage is a recorded gap", async () => {
	const priced = (text: string, cost: number): Reply => {
		const reply = fauxAssistantMessage(text);
		reply.usage = { ...reply.usage, cost: { ...reply.usage.cost, total: cost } };
		return reply;
	};
	const run = await fauxSession([bridge], [priced("before", 0.5), priced("during", 0.25)], []);
	try {
		const id = run.session.sessionManager.getSessionId();
		await vi.waitFor(() => expect(query(state.dbPath, "select id from sessions where id = ?", id)).toHaveLength(1), {
			timeout: 15000,
		});
		await run.session.prompt("first");
		await vi.waitFor(() =>
			expect(query<Row>(state.dbPath, "select cost from sessions where id = ?", id)[0].cost).toBe(0.5),
		);
		const before = query<{ seq: number }>(state.dbPath, "select seq from events where session_id = ? order by seq", id);

		const killed = runtimePid(state.pidPath)!;
		const killedAt = Date.now();
		process.kill(killed, "SIGKILL");
		await run.session.prompt("second"); // the session does not depend on the runtime
		expect(run.session.messages.at(-1)).toMatchObject({ role: "assistant" });

		// The bridge starts a new runtime and sends its whole current state.
		await vi.waitFor(() => expect(runtimePid(state.pidPath)).not.toBe(killed), { timeout: 15000 });
		await vi.waitFor(
			() => expect(query<Row>(state.dbPath, "select cost from sessions where id = ?", id)[0].cost).toBe(0.75),
			{
				timeout: 15000,
			},
		);
		const gaps = query<{ data: string }>(
			state.dbPath,
			"select data from events where session_id = ? and type = 'gap'",
			id,
		).map((row) => JSON.parse(row.data));
		expect(gaps).toHaveLength(1);
		// The gap covers the outage: it starts no later than the kill and ends after it.
		expect(gaps[0].since).toBeLessThanOrEqual(killedAt);
		expect(gaps[0].until).toBeGreaterThan(killedAt);
		// The second turn's run-state changes happened while nothing listened; they are not in the history.
		const during = query<Row>(
			state.dbPath,
			"select type from events where session_id = ? and type = 'run_state' and at > ? and at < ?",
			id,
			gaps[0].since,
			gaps[0].until,
		);
		expect(during).toEqual([]);
		// History from before the outage is intact.
		const kept = query<{ seq: number }>(
			state.dbPath,
			"select seq from events where session_id = ? and seq <= ? order by seq",
			id,
			before.at(-1)!.seq,
		);
		expect(kept).toEqual(before);
		// The bridge started this runtime itself; when it dies too, the bridge starts another.
		const second = runtimePid(state.pidPath)!;
		process.kill(second, "SIGKILL");
		await vi.waitFor(() => expect([undefined, second]).not.toContain(runtimePid(state.pidPath)), { timeout: 15000 });
		await vi.waitFor(
			() =>
				expect(query(state.dbPath, "select 1 from events where session_id = ? and type = 'gap'", id)).toHaveLength(2),
			{ timeout: 15000 },
		);
	} finally {
		await close(run);
	}
}, 40000);
