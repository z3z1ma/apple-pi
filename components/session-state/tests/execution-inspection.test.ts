import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import type { RunInput, RunObservation } from "../src/run-observation.js";
import { migrate } from "../src/schema.js";
import { progressIn } from "../src/work-inspection.js";

const databases: DatabaseSync[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});
function fixture() {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	databases.push(db);
	for (const id of ["root", "a", "b", "c", "other"])
		db.prepare(
			"insert into sessions (id, kind, cwd, name, run_state, generation, source, updated_at, reports_to) values (?, 'root', '/', ?, 'idle', 1, 'test', 0, ?)",
		).run(id, id, id === "root" || id === "other" ? null : "root");
	const event = (person: string, at: number, type: string, data: unknown, source = "bridge", generation = 1) =>
		db
			.prepare("insert into events (session_id, generation, at, source, type, data) values (?, ?, ?, ?, ?, ?)")
			.run(person, generation, at, source, type, JSON.stringify(data));
	const observe = (person: string, at: number, observation: RunObservation) =>
		event(person, at, "execution", observation);
	const start = (person: string, at: number, kind: RunInput["kind"] = "user") =>
		observe(person, at, {
			phase: "start",
			id: person,
			active: true,
			input: { kind, command: null },
			mailReceived: false,
		});
	const settle = (person: string, at: number) => observe(person, at, { phase: "settle", id: person, aborted: false });
	return {
		db,
		event,
		observe,
		start,
		settle,
		inspect: (from = 0, to = 20) => progressIn(db, "root", { cwd: "/", from, to }, {}, { limit: 100 }).execution,
	};
}

test("the approved timeline preserves the pre-mail prefix, mixed tail, unknown intervals and gaps", () => {
	const { observe, start, settle, inspect } = fixture();
	start("a", 0);
	observe("a", 8, { phase: "input", id: "a", input: { kind: "mail", command: "delivery" } });
	settle("a", 20);
	start("b", 5, "mail");
	settle("b", 15);
	start("c", 0, "unknown");
	observe("c", 6, { phase: "break", id: "c" });
	observe("c", 12, {
		phase: "resume",
		id: "c",
		active: true,
		input: { kind: "unknown", command: null },
		mailReceived: false,
	});
	settle("c", 20);
	const result = inspect();
	expect(result.available).toBe(true);
	if (!result.available) return;
	expect(result.summary).toMatchObject({
		observedMs: 44,
		mailInitiatedMs: 10,
		mailTailMs: 12,
		noTypedMailMs: 8,
		unknownMs: 14,
		unobservedMs: 6,
		incomingMailAssociatedShare: 0.5,
	});
	const earlier = inspect(0, 7);
	if (!earlier.available) throw new Error(earlier.reason);
	expect(earlier.summary.mailTailMs).toBe(0);
	expect(earlier.summary.noTypedMailMs).toBe(7);
	expect(earlier.observations.rows.some((row) => row.observation.phase === "input")).toBe(false);
});

test("preparation that never executes contributes no run time; legacy activity stays unknown", () => {
	const { observe, event, inspect } = fixture();
	observe("a", 0, {
		phase: "prepare",
		id: "a",
		active: false,
		input: { kind: "user", command: null },
		mailReceived: false,
	});
	event("a", 1, "run_state", { to: "compacting" });
	observe("a", 8, { phase: "settle", id: "a", aborted: true });
	event("b", 0, "run_state", { to: "thinking" });
	event("b", 10, "run_state", { to: "idle" });
	const result = inspect();
	if (!result.available) throw new Error(result.reason);
	expect(result.summary).toMatchObject({
		observedMs: 10,
		unknownMs: 10,
		preparedRuns: 1,
		startedRuns: 0,
		abortedRuns: 1,
	});
});

test("generation replacement and late old-bridge facts never double count an emitter", () => {
	const { event, start, inspect } = fixture();
	start("a", 0);
	event("a", 5, "incarnation_started", {}, "bridge", 2);
	event(
		"a",
		6,
		"execution",
		{ phase: "start", id: "replacement", active: true, input: { kind: "mail", command: "m" }, mailReceived: false },
		"bridge",
		2,
	);
	event("a", 7, "execution", { phase: "input", id: "a", input: { kind: "mail", command: "stale" } }, "bridge", 1);
	event("a", 10, "execution", { phase: "settle", id: "replacement", aborted: false }, "bridge", 2);
	const result = inspect();
	if (!result.available) throw new Error(result.reason);
	expect(result.summary).toMatchObject({ observedMs: 9, noTypedMailMs: 5, mailInitiatedMs: 4 });
});

test("temporary time follows immutable caller ancestry and historical membership, not its reporting line", () => {
	const { db, event, start, settle, inspect } = fixture();
	event("peer", 0, "program_peer_created", { caller: "a" }, "runtime");
	start("peer", 0, "program");
	settle("peer", 20);
	event("a", 10, "transferred", { from: "root", to: "other" }, "runtime");
	db.prepare("update sessions set reports_to = 'other' where id = 'a'").run();
	event("peer", 20, "person_discarded", {}, "runtime");
	const result = inspect();
	if (!result.available) throw new Error(result.reason);
	expect(result.summary).toMatchObject({ observedMs: 10, delegatedObservedMs: 10 });
	expect(result.emitters.rows[0]).toMatchObject({ emitter: "person:peer", accountedTo: "person:a" });
	const task = progressIn(db, "root", { cwd: "/", from: 0, to: 20 }, { task: "task" }).execution;
	expect(task.available).toBe(false);
});

test("a reconnect gap removes unsupported continuity and an open tail ends at the last observation", () => {
	const { event, start, observe, inspect } = fixture();
	start("a", 0);
	event("a", 6, "tool_started", { name: "bash" });
	event("a", 12, "gap", { since: 6, until: 12 }, "runtime");
	observe("a", 12, {
		phase: "resume",
		id: "a",
		active: true,
		input: { kind: "user", command: null },
		mailReceived: false,
	});
	event("a", 16, "tool_ended", { name: "bash" });
	const result = inspect();
	if (!result.available) throw new Error(result.reason);
	expect(result.summary).toMatchObject({ observedMs: 10, noTypedMailMs: 10, unobservedMs: 10 });
});
