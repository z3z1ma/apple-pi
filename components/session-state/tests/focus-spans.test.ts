import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { mayReadEntry, maySearchTask, reconstructSpans, taskSpans } from "../src/focus-spans.js";
import { migrate } from "../src/schema.js";

function database() {
	const db = new DatabaseSync(":memory:");
	migrate(db);
	const person = db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to) values (?, 'root', '/', 'idle', 1, 'test', 0, ?)",
	);
	person.run("boss", null);
	person.run("lead", "boss");
	person.run("ada", "lead");
	person.run("ben", "lead");
	person.run("eve", null);
	return db;
}

test("focus changes write spans: opening, moving to another task, and clearing", () => {
	const db = database();
	const focus = (person: string, task: string) =>
		db
			.prepare(
				"insert into work_focus (person, task_id) values (?, ?) on conflict(person) do update set task_id = excluded.task_id",
			)
			.run(person, task);
	focus("ada", "t1");
	focus("ada", "t1");
	focus("ada", "t2");
	db.prepare("delete from work_focus where person = ?").run("ada");
	const spans = taskSpans(db, ["t1", "t2"]);
	expect(spans.map((span) => [span.task, span.to !== null, span.reconstructed])).toEqual([
		["t1", true, false],
		["t2", true, false],
	]);
	expect(spans[0]!.to!).toBeLessThanOrEqual(spans[1]!.from);
	focus("ben", "t1");
	expect(taskSpans(db, ["t1"]).at(-1)).toMatchObject({ person: "ben", task: "t1", to: null });
});

test("earlier focus history is replayed once from work changes and their task posts", () => {
	const db = database();
	const change = db.prepare(
		"insert into work_changes (command_id, task_id, person, action, previous_bundle) values (?, ?, ?, ?, null)",
	);
	const post = db.prepare(
		"insert into thread_messages (id, thread_id, seq, sender, body, at) values (?, 'task:t', ?, 'harness', '', ?)",
	);
	db.prepare(
		"insert into threads (id, kind, subject, created_by, created_at) values ('task:t', 'task', 't', 'harness', 0)",
	).run();
	const history: [string, string, string, number][] = [
		["ada", "t1", "take", 100],
		["ada", "t2", "focus", 200],
		["ada", "t2", "finish", 300],
		["ben", "t1", "assign", 150],
		["ben", "t1", "close", 400],
		["eve", "t3", "take", 500],
	];
	history.forEach(([person, task, action, at], index) => {
		change.run(`c${index}`, task, person, action);
		post.run(`c${index}:post`, index + 1, at);
	});
	db.exec("drop trigger focus_span_open");
	db.prepare("insert into work_focus (person, task_id) values ('eve', 't3')").run();
	reconstructSpans(db, 1000);
	reconstructSpans(db, 2000);
	expect(taskSpans(db, ["t1", "t2", "t3"]).map((span) => [span.person, span.task, span.from, span.to])).toEqual([
		["ada", "t1", 100, 200],
		["ben", "t1", 150, 400],
		["ada", "t2", 200, 300],
		["eve", "t3", 500, null],
	]);
});

test("a task's spans are searchable by its people, managers above them, and the operator", () => {
	const db = database();
	db.prepare("insert into work_focus (person, task_id) values ('ada', 't1')").run();
	expect(maySearchTask(db, "ada", "t1")).toBe(true);
	expect(maySearchTask(db, "lead", "t1")).toBe(true);
	expect(maySearchTask(db, "boss", "t1")).toBe(true);
	expect(maySearchTask(db, "operator", "t1")).toBe(true);
	expect(maySearchTask(db, "ben", "t1")).toBe(false);
	expect(maySearchTask(db, "eve", "t1")).toBe(false);
	const during = (taskSpans(db, ["t1"])[0]!.from as number) + 1;
	expect(mayReadEntry(db, "lead", "ada", during)).toBe(true);
	expect(mayReadEntry(db, "lead", "ada", during - 10_000)).toBe(false);
	expect(mayReadEntry(db, "eve", "ada", during)).toBe(false);
	expect(mayReadEntry(db, "ada", "ada", undefined)).toBe(true);
	expect(mayReadEntry(db, "lead", "ada", undefined)).toBe(false);
});
