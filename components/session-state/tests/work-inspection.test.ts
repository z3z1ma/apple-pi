import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, test } from "vitest";
import { migrate } from "../src/schema.js";
import { bottlenecksIn, progressIn } from "../src/work-inspection.js";

const databases: DatabaseSync[] = [];
afterEach(() => {
	for (const db of databases.splice(0)) db.close();
});
function fixture() {
	const db = new DatabaseSync(":memory:");
	databases.push(db);
	migrate(db);
	for (const [id, manager] of [
		["root", null],
		["dev", "root"],
		["lead", "root"],
		["foreign", null],
	])
		db.prepare(
			"insert into sessions (id, kind, cwd, name, run_state, generation, source, updated_at, reports_to) values (?, 'root', '/', ?, 'idle', 1, 'test', 0, ?)",
		).run(id, id, manager);
	const task = (
		id: string,
		holder: string | null = "dev",
		close: number | null = null,
		status: string | null = null,
	) => {
		db.prepare(
			"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, opened_at, archived_at, close_status) values (?, ?, '/', 'root', 1, ?, 0, ?, ?)",
		).run(id, `/missing/${id}`, `task:${id}`, close, status);
		if (holder)
			db.prepare(
				"insert into assignments (person, task_id, assigned_by, assigned_at, ended_at, end_reason, outcome) values (?, ?, 'root', 0, ?, ?, ?)",
			).run(holder, id, close, close === null ? null : "finished", close === null ? null : "Reported outcome");
	};
	const link = (id: string, from: string, to: string, start = 0, end: number | null = null, relation = "blocks") => {
		const [fk, fi] = from.split(":"),
			[tk, ti] = to.split(":");
		db.prepare(
			"insert into links (id, organization, from_kind, from_id, to_kind, to_id, relation, recorded_by, inferred, confidence, created_at, resolved_at) values (?, 'root', ?, ?, ?, ?, ?, 'dev', 1, 0.7, ?, ?)",
		).run(id, fk, fi, tk, ti, relation, start, end);
		return { ref: `link:${id}`, from, to };
	};
	return { db, task, link };
}

test("progress unions waits per task, distinguishes completion from reported evidence, and pages without a hidden default", () => {
	const { db, task, link } = fixture();
	task("a");
	task("done", "dev", 80, "done");
	task("unverified", "dev", 75, "done");
	task("cancelled", null, 50, "cancelled");
	link("w1", "task:a", "person:lead", 10, 50);
	link("w2", "task:a", "person:lead", 30, 70);
	link("result", "task:done", "commit:abc", 60, null, "produced");
	link("future", "check:later", "task:done", 110, null, "verifies");
	const summary = progressIn(db, "root", { cwd: "/", from: 20, to: 100 });
	expect(summary.summary).toMatchObject({
		completed: 2,
		cancelled: 1,
		open: 1,
		held: 1,
		waitingTaskMs: 50,
		completedWithResultRecords: 1,
	});
	expect(summary.open).toMatchObject({ total: 1, returned: 0, rows: [] });
	const detail = progressIn(db, "root", { cwd: "/", from: 20, to: 100 }, {}, { limit: 1 });
	expect(detail.closures).toMatchObject({ total: 3, returned: 1, nextOffset: 1 });
	expect(detail.closures.rows[0]).toMatchObject({
		ref: "task:done",
		elapsedMs: 80,
		outcomes: [{ outcome: "Reported outcome" }],
		evidence: [{ ref: "link:result", inferred: true }],
	});
	expect(detail.closures.rows[0].evidence).toHaveLength(1);
	expect(
		progressIn(db, "root", { cwd: "/", from: 20, to: 100 }, {}, { limit: 1, offset: 1 }).closures.rows[0],
	).toMatchObject({ ref: "task:unverified", evidence: [], outcomes: [{ outcome: "Reported outcome" }] });
	expect(
		progressIn(db, "root", { cwd: "/", from: 20, to: 100 }, {}, { limit: 1, offset: 2 }).closures.rows[0].ref,
	).toBe("task:cancelled");
	expect(() => progressIn(db, "root", { cwd: "/", to: 100 }, {}, { offset: 1 })).toThrow("offset");
});

test("a held task exposes current owner freshness separately from the historical work snapshot", () => {
	const { db, task } = fixture();
	task("a");
	db.prepare("update sessions set updated_at = 130 where id = 'dev'").run();
	db.prepare(
		"insert into incarnations (session_id, generation, pid, process_started_at, process_state, started_at, ended_at, source, updated_at) values ('dev', 1, 1, 0, 'exited', 0, 130, 'test', 130)",
	).run();
	const error = db
		.prepare(
			"insert into events (at, source, session_id, type, data) values (120, 'bridge', 'dev', 'last_error_changed', ?)",
		)
		.run(JSON.stringify({ to: "private failure detail" }));
	const result = progressIn(db, "root", { cwd: "/", to: 100 }, {}, { limit: 1 });
	expect(result.window.to).toBe(100);
	expect(result.open.rows[0]).toMatchObject({ ref: "task:a", state: "held", holders: ["person:dev"] });
	expect(result.holders.rows[0]).toMatchObject({
		ref: "person:dev",
		current: { processState: "exited", observedAt: 130, lastError: { at: 120, ref: `event:${error.lastInsertRowid}` } },
	});
	expect(JSON.stringify(result)).not.toContain("private failure detail");
});

test("waiting exposure respects ownership and assignment intervals rather than today's team", () => {
	const { db, task, link } = fixture();
	task("a");
	link("wait", "task:a", "person:lead", 0);
	db.prepare("update assignments set assigned_at = 30, ended_at = 70 where task_id = 'a'").run();
	expect(progressIn(db, "root", { cwd: "/", from: 0, to: 100 }, { person: "dev" }).summary.waitingTaskMs).toBe(40);
	db.prepare("update work_tasks set organization = 'lead' where id = 'a'").run();
	db.prepare(
		"insert into events (at, source, session_id, type, data) values (50, 'test', 'lead', 'transferred', ?)",
	).run(JSON.stringify({ from: null, to: "root" }));
	expect(progressIn(db, "root", { cwd: "/", from: 0, to: 100 }).summary.waitingTaskMs).toBe(50);
	expect(progressIn(db, "foreign", { cwd: "/", from: 0, to: 100 }).summary.waitingTaskMs).toBe(0);
});

test("bottlenecks walks upstream once through diamonds and cycles without inventing assignment edges", () => {
	const { db, task, link } = fixture();
	for (const id of ["a", "b", "c", "d", "unrelated"]) task(id);
	const edges = [
		link("ab", "task:a", "task:b"),
		link("ac", "task:a", "task:c"),
		link("bd", "task:b", "task:d"),
		link("cd", "task:c", "task:d"),
		link("db", "task:d", "task:b"),
		link("decision", "task:d", "person:lead", 20, null, "requires_decision"),
	];
	const result = bottlenecksIn(db, "root", { cwd: "/", from: 0, to: 100 }, {}, { limit: 10 });
	const lead = result.targets.rows.find((row) => row.ref === "person:lead")!;
	expect(lead.affectedTasks).toBe(4);
	expect(lead.paths.map((path) => path.ref).sort()).toEqual(["task:a", "task:b", "task:c", "task:d"]);
	expect(lead.waits[0]).toMatchObject({ inferred: true, confidence: 0.7, windowWaitMs: 80 });
	expect(result.cycles.rows).toEqual([{ references: ["task:b", "task:d"], links: ["link:bd", "link:db"] }]);
	expect(result.people.rows.find((row) => row.ref === "person:dev")!.tasks.sort()).toEqual([
		"task:a",
		"task:b",
		"task:c",
		"task:d",
		"task:unrelated",
	]);
	for (const path of lead.paths) {
		let at = path.ref;
		for (const ref of path.links) {
			const edge = edges.find((candidate) => candidate.ref === ref);
			expect(edge).toMatchObject({ from: at });
			at = edge!.to;
		}
		expect(at).toBe(lead.ref);
	}
});

test("same-task refocusing is not a switch and later outcomes do not leak into a past report", () => {
	const { db, task } = fixture();
	task("a");
	task("b");
	db.prepare(
		"insert into threads (id, kind, subject, created_by, created_at) values ('task:a', 'task', 'a', 'root', 0)",
	).run();
	for (const [id, selected, at] of [
		["one", "a", 10],
		["same", "a", 20],
		["switch", "b", 30],
	] as const) {
		db.prepare("insert into work_changes (command_id, person, task_id, action) values (?, 'dev', ?, 'focus')").run(
			id,
			selected,
		);
		db.prepare("insert into thread_messages (id, thread_id, sender, body, at) values (?, 'task:a', 'dev', '', ?)").run(
			`${id}:post`,
			at,
		);
	}
	db.prepare(
		"update assignments set ended_at = 120, end_reason = 'finished', outcome = 'future' where task_id = 'a'",
	).run();
	const result = progressIn(db, "root", { cwd: "/", from: 15, to: 100 }, {}, { limit: 10 });
	expect(result.summary.focusChanges).toBe(1);
	expect(result.holders.rows[0].focusChanges[0]).toMatchObject({ from: "task:a", to: "task:b", at: 30 });
	expect(result.open.rows.find((row) => row.ref === "task:a")!.outcomes).toEqual([]);
});
