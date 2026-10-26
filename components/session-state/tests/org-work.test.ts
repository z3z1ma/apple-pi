import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { workIn } from "../src/inspect.js";
import { migrate } from "../src/schema.js";

const HOUR = 3_600_000;

test("work is classified once, exposes holders and load, and changes after assignment", () => {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	for (const [id, manager] of [
		["root", null],
		["dev", "root"],
	] as const)
		db.prepare(
			"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to) values (?, 'root', '/', 'idle', 1, 'test', 0, ?)",
		).run(id, manager);
	for (const id of ["ready-a", "ready-b", "waiting", "working-a", "working-b"])
		db.prepare(
			"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, opened_at) values (?, ?, '/', 'root', 0, ?, 0)",
		).run(id, `/${id}`, `task:${id}`);
	const assign = (id: string, at: number) =>
		db
			.prepare("insert into assignments (person, task_id, assigned_by, assigned_at) values ('dev', ?, 'root', ?)")
			.run(id, at);
	for (const id of ["waiting", "working-a", "working-b"]) assign(id, 0);
	db.prepare(
		"insert into links (id, from_kind, from_id, to_kind, to_id, relation, recorded_by, inferred, created_at) values ('block', 'task', 'waiting', 'person', 'root', 'requires_decision', 'dev', 0, 0)",
	).run();
	const result = workIn(db, "root", { cwd: "/", to: HOUR });
	expect(result.ready.map((t) => t.ref)).toEqual(["task:ready-a", "task:ready-b"]);
	expect(result.waiting.map((t) => t.ref)).toEqual(["task:waiting"]);
	expect(result.inProgress.map((t) => t.ref)).toEqual(["task:working-a", "task:working-b"]);
	expect(result.waiting[0]).toMatchObject({ ageHours: 1, holders: ["person:dev"], waits: ["link:block"] });
	expect(result.multiple).toEqual([
		{ person: "person:dev", tasks: ["task:waiting", "task:working-a", "task:working-b"] },
	]);
	assign("ready-a", 2 * HOUR);
	const afterAssignment = workIn(db, "root", { cwd: "/", to: 3 * HOUR });
	expect(afterAssignment.inProgress.map((t) => t.ref)).toContain("task:ready-a");
	expect(afterAssignment.ready.map((t) => t.ref)).toEqual(["task:ready-b"]);
	expect(workIn(db, "root", { cwd: "/", to: HOUR }).ready.map((t) => t.ref)).toContain("task:ready-a");
	expect(workIn(db, "root", { cwd: "/", to: HOUR }, { person: "dev" }).ready).toEqual([]);
	expect(workIn(db, "root", { cwd: "/", to: HOUR }, { task: "ready-b" }).ready.map((t) => t.ref)).toEqual([
		"task:ready-b",
	]);
	expect(workIn(db, "root", { cwd: "/", to: HOUR }, { subtree: "dev" }).inProgress).toHaveLength(2);
	db.close();
});

test("work arrivals and closes belong to their event window and historical organization", () => {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	for (const [id, manager] of [
		["root", null],
		["incoming", "root"],
	] as const)
		db.prepare(
			"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to) values (?, 'root', '/', 'idle', 1, 'test', 0, ?)",
		).run(id, manager);
	db.prepare(
		"insert into events (at, source, session_id, type, data) values (?, 'runtime', 'incoming', 'reports_to_changed', ?)",
	).run(2 * HOUR, JSON.stringify({ from: null, to: "root" }));
	for (const [id, opened, closed, status] of [
		["before", 0, HOUR, "done"],
		["done", 2 * HOUR, 3 * HOUR, "done"],
		["cancel", 2 * HOUR, 3 * HOUR, "cancelled"],
		["boundary", 4 * HOUR, null, null],
	] as const)
		db.prepare(
			"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, opened_at, archived_at, close_status) values (?, ?, '/', 'incoming', 0, ?, ?, ?, ?)",
		).run(id, `/${id}`, `task:${id}`, opened, closed, status);
	const result = workIn(db, "root", { cwd: "/", from: 0, to: 4 * HOUR });
	expect(result.opened.map((t) => t.ref)).toEqual(["task:cancel", "task:done"]);
	expect(result.closed).toEqual([
		{ ref: "task:cancel", at: 3 * HOUR, status: "cancelled" },
		{ ref: "task:done", at: 3 * HOUR, status: "done" },
	]);
	expect(result.ready).toEqual([]);
	db.prepare(
		"insert into assignments (person, task_id, assigned_by, assigned_at, ended_at, end_reason) values ('incoming', 'done', 'root', ?, ?, 'finished')",
	).run(2 * HOUR, 3 * HOUR);
	expect(workIn(db, "root", { cwd: "/", from: 2 * HOUR, to: 4 * HOUR }, { person: "incoming" }).closed).toEqual([
		{ ref: "task:done", at: 3 * HOUR, status: "done" },
	]);
	db.close();
});
