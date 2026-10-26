import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { areasOf, expertsOn, type Scope, waitsIn } from "../src/inspect.js";
import { migrate } from "../src/schema.js";

const HOUR = 3_600_000;

/** An organization: boss with reports ada (awake, idle), bo (at home), cy (let go); all working in one repository. */
function organization() {
	const dir = mkdtempSync(join(tmpdir(), "apple-pi-inspect-"));
	const repo = join(dir, "repo");
	mkdirSync(repo);
	const db = new DatabaseSync(join(dir, "state.db"));
	migrate(db);
	const person = (id: string, name: string, reportsTo: string | null, retired: number | null = null) =>
		db
			.prepare(
				"insert into sessions (id, kind, cwd, name, run_state, generation, source, updated_at, reports_to, retired_at, retired_reason) values (?, 'root', ?, ?, 'idle', 1, 'test', 0, ?, ?, ?)",
			)
			.run(id, repo, name, reportsTo, retired, retired ? "done" : null);
	person("boss", "Boss", null);
	person("ada", "Ada", "boss");
	person("bo", "Bo", "boss");
	person("cy", "Cy", "boss", 5 * HOUR);
	db.prepare(
		"insert into incarnations (session_id, generation, pid, process_started_at, process_state, started_at, source, updated_at) values ('ada', 1, 1, 0, 'alive', 0, 'test', 0)",
	).run();
	let entry = 0;
	const touch = (who: string, tool: string, path: string, at: number) =>
		db
			.prepare(
				"insert into messages (session_id, entry_id, part, at, role, tool, size, preview, source) values (?, ?, ?, ?, 'tool_call', ?, 0, ?, 'test')",
			)
			.run(who, `e${++entry}`, `c${entry}`, at, tool, path);
	touch("ada", "edit", "components/session-state/src/fitness.ts", 1 * HOUR);
	touch("ada", "read", "components/session-state/src/fitness.ts", 1.5 * HOUR);
	touch("ada", "read", "components/session-state/src/links.ts", 0.5 * HOUR);
	touch("bo", "write", join(repo, "components/session-state/src/runtime.ts"), 2 * HOUR);
	touch("cy", "read", "docs/organization.md", 1 * HOUR);
	const bundle = join(dir, "task-fit");
	mkdirSync(bundle);
	writeFileSync(join(bundle, "task.md"), "Status: done\n\n# Count compute in fitness\n");
	db.prepare(
		"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, opened_at) values ('fit', ?, ?, 'boss', 1, 'task:fit', 0)",
	).run(bundle, repo);
	db.prepare(
		"insert into assignments (person, task_id, assigned_by, assigned_at, ended_at, outcome, end_reason) values ('ada', 'fit', 'boss', 0, ?, 'Counted.', 'finished')",
	).run(3 * HOUR);
	db.prepare("insert into events (at, source, session_id, type, data) values (?, 'bridge', 'bo', 'run_state', ?)").run(
		3 * HOUR,
		JSON.stringify({ from: "thinking", to: "compacting" }),
	);
	return { db, repo };
}

test("asking about an area lists who read and edited there, how recently, with what task, and how warm their context is", () => {
	const { db, repo } = organization();
	const result = expertsOn(db, "boss", "components/session-state", { cwd: repo });
	expect(result.map((p) => [p.ref, p.reads, p.edits])).toEqual([
		["person:ada", 2, 1],
		["person:bo", 0, 1],
	]);
	const [ada, bo] = result;
	expect(ada).toMatchObject({ status: "idle", lastTouch: 1.5 * HOUR, compactionSince: false });
	expect(ada.tasks).toEqual([
		{ ref: "task:fit", title: "Count compute in fitness", finished: true, outcome: "Counted." },
	]);
	expect(bo).toMatchObject({ status: "at home", lastTouch: 2 * HOUR, compactionSince: true, tasks: [] });
	expect(expertsOn(db, "boss", join(repo, "components/session-state"), { cwd: "/" })).toEqual(result);
});

test("a word matches touched paths containing it, and a former member is marked as having left", () => {
	const { db, repo } = organization();
	expect(expertsOn(db, "boss", "fitness", { cwd: repo }).map((p) => p.ref)).toEqual(["person:ada"]);
	expect(expertsOn(db, "boss", "docs", { cwd: repo })).toMatchObject([{ ref: "person:cy", status: "left" }]);
});

test("asking about a person lists the directories it touched; a window keeps only touches inside it", () => {
	const { db, repo } = organization();
	const all = areasOf(db, "boss", "ada", { cwd: repo });
	expect(all).toEqual([
		{ ref: `file:${join(repo, "components/session-state/src")}`, reads: 2, edits: 1, lastTouch: 1.5 * HOUR },
	]);
	const late = areasOf(db, "boss", "ada", { cwd: repo, from: 1.2 * HOUR, to: 4 * HOUR });
	expect(late).toMatchObject([{ reads: 1, edits: 0 }]);
});

test("a subtree scope keeps only people in that subtree", () => {
	const { db, repo } = organization();
	const scoped = expertsOn(db, "boss", "components/session-state", { cwd: repo, subtree: "bo" });
	expect(scoped.map((p) => p.ref)).toEqual(["person:bo"]);
});

/** Waits in the organization: ada's two tasks wait on bo's decision, and boss's task waits on ada's task. */
function waiting() {
	const { db, repo } = organization();
	const task = (id: string, holder: string | null) => {
		db.prepare(
			"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, opened_at) values (?, ?, ?, 'boss', 0, ?, 0)",
		).run(id, join(repo, id), repo, `task:${id}`);
		if (holder)
			db.prepare("insert into assignments (person, task_id, assigned_by, assigned_at) values (?, ?, 'boss', 0)").run(
				holder,
				id,
			);
	};
	task("api", "ada");
	task("ui", "ada");
	task("docs", "boss");
	db.prepare(
		"insert into sessions (id, kind, cwd, name, run_state, generation, source, updated_at, reports_to) values ('ed', 'root', ?, 'Ed', 'idle', 1, 'test', 0, 'bo')",
	).run(repo);
	const wait = (
		id: string,
		from: string,
		toKind: string,
		to: string,
		relation: string,
		by: string,
		at: number,
		resolved: number | null = null,
	) =>
		db
			.prepare(
				"insert into links (id, from_kind, from_id, to_kind, to_id, relation, reason, recorded_by, inferred, created_at, resolved_at) values (?, 'task', ?, ?, ?, ?, ?, ?, 0, ?, ?)",
			)
			.run(id, from, toKind, to, relation, `why ${id}`, by, at, resolved);
	wait("w1", "api", "person", "bo", "requires_decision", "ada", 1 * HOUR);
	wait("w2", "ui", "person", "bo", "requires_decision", "ada", 2 * HOUR);
	wait("w3", "docs", "task", "api", "blocks", "boss", 3 * HOUR);
	wait("w4", "ui", "person", "ed", "requires_decision", "ada", 1 * HOUR, 3.5 * HOUR);
	return { db, repo };
}

test("open waits are grouped by what they wait on, the most-waited-on first, with ages and reasons", () => {
	const { db, repo } = waiting();
	const result = waitsIn(db, "boss", { cwd: repo, to: 4 * HOUR });
	expect(result.open).toBe(3);
	expect(result.targets.map((t) => [t.ref, t.waits.map((w) => w.ref)])).toEqual([
		["person:bo", ["link:w1", "link:w2"]],
		["task:api", ["link:w3"]],
	]);
	expect(result.targets[0].waits[0]).toMatchObject({
		from: "task:api",
		relation: "requires_decision",
		reason: "why w1",
		ageHours: 3,
		recordedBy: "person:ada",
	});
});

test("a wait across teams is marked, and a window lists the waits resolved in it", () => {
	const { db, repo } = waiting();
	// A second lead under boss takes bo: ada (under boss) and bo (under lea) are now on different teams.
	db.prepare(
		"insert into sessions (id, kind, cwd, name, run_state, generation, source, updated_at, reports_to) values ('lea', 'root', ?, 'Lea', 'idle', 1, 'test', 0, 'boss')",
	).run(repo);
	db.prepare("update sessions set reports_to = 'lea' where id = 'bo'").run();
	const result = waitsIn(db, "boss", { cwd: repo, from: 3 * HOUR, to: 4 * HOUR });
	const toBo = result.targets.find((t) => t.ref === "person:bo")!;
	expect(toBo.waits.every((w) => w.crossesTeams)).toBe(true);
	expect(result.targets.find((t) => t.ref === "task:api")!.waits[0].crossesTeams).toBe(false);
	expect(result.unblocked.map((w) => w.ref)).toEqual(["link:w4"]);
	expect(waitsIn(db, "boss", { cwd: repo, from: 0, to: 3 * HOUR }).unblocked).toEqual([]);
});

test("person, task, and subtree scopes keep only their waits", () => {
	const { db, repo } = waiting();
	const refs = (scope: Scope) =>
		waitsIn(db, "boss", { cwd: repo, to: 4 * HOUR }, scope).targets.flatMap((t) => t.waits.map((w) => w.ref));
	expect(refs({ person: "bo" }).sort()).toEqual(["link:w1", "link:w2"]);
	expect(refs({ task: "api" }).sort()).toEqual(["link:w1", "link:w3"]);
	expect(refs({ subtree: "ada" }).sort()).toEqual(["link:w1", "link:w2", "link:w3"]);
});

test("another organization's resolved wait never shows, even when its recorder exists on this machine", () => {
	const { db, repo } = waiting();
	db.prepare(
		"insert into sessions (id, kind, cwd, name, run_state, generation, source, updated_at) values ('stranger', 'root', ?, 'Stranger', 'idle', 1, 'test', 0)",
	).run(repo);
	db.prepare(
		"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, opened_at) values ('theirs', '/x', '/x', 'stranger', 0, 'task:theirs', 0)",
	).run();
	db.prepare(
		"insert into links (id, from_kind, from_id, to_kind, to_id, relation, reason, recorded_by, inferred, created_at, resolved_at) values ('private', 'task', 'theirs', 'person', 'stranger', 'blocks', 'secret', 'stranger', 0, ?, ?)",
	).run(HOUR, 2 * HOUR);
	expect(waitsIn(db, "boss", { cwd: repo, from: 0, to: 4 * HOUR }).unblocked.map((w) => w.ref)).not.toContain(
		"link:private",
	);
});

test("a past view keeps the holders it had then, and a resolved wait shows how long it waited", () => {
	const { db, repo } = waiting();
	db.prepare("update assignments set ended_at = ? where task_id = 'api'").run(5 * HOUR);
	const asOfFour = waitsIn(db, "boss", { cwd: repo, from: 0, to: 4 * HOUR }, { person: "ada" });
	expect(asOfFour.open).toBe(3);
	expect(asOfFour.unblocked).toMatchObject([{ ref: "link:w4", ageHours: 2.5, resolvedAt: 3.5 * HOUR }]);
});

test("the waiter is whoever held the waiting task, not whoever recorded the wait", () => {
	const { db, repo } = waiting();
	// bo manages ed, so bo and ed are one team; ada, who holds the waiting task, is on boss's team.
	db.prepare(
		"insert into links (id, from_kind, from_id, to_kind, to_id, relation, recorded_by, inferred, created_at) values ('w5', 'task', 'api', 'person', 'ed', 'requires_decision', 'bo', 0, ?)",
	).run(HOUR);
	const wait = waitsIn(db, "boss", { cwd: repo, to: 4 * HOUR })
		.targets.find((t) => t.ref === "person:ed")!
		.waits.find((w) => w.ref === "link:w5")!;
	expect(wait).toMatchObject({ waiters: ["person:ada"], recordedBy: "person:bo", crossesTeams: true });
});

test("a subtree view as of a past moment keeps the people who were in that subtree then", () => {
	const { db, repo } = waiting();
	// ada sat under boss until 5h, when she moved under bo; a 4h view of boss's subtree still holds her waits.
	db.prepare(
		"insert into events (at, source, session_id, type, data) values (?, 'client', 'ada', 'transferred', ?)",
	).run(5 * HOUR, JSON.stringify({ from: "boss", to: "bo", by: "boss" }));
	db.prepare("update sessions set reports_to = 'bo' where id = 'ada'").run();
	const asOfFour = waitsIn(db, "boss", { cwd: repo, to: 4 * HOUR }, { subtree: "ada" });
	expect(asOfFour.open).toBe(3);
	const underBoAsOfFour = waitsIn(db, "boss", { cwd: repo, to: 4 * HOUR }, { subtree: "bo" });
	expect(underBoAsOfFour.targets.flatMap((t) => t.waits.map((w) => w.ref)).sort()).toEqual(["link:w1", "link:w2"]);
});

test("a task scope matches only task ends, never another kind with the same id", () => {
	const { db, repo } = waiting();
	db.prepare(
		"insert into links (id, from_kind, from_id, to_kind, to_id, relation, recorded_by, inferred, created_at) values ('same', 'person', 'ada', 'file', 'api', 'blocks', 'ada', 0, ?)",
	).run(HOUR);
	const refs = waitsIn(db, "boss", { cwd: repo, to: 4 * HOUR }, { task: "api" }).targets.flatMap((t) =>
		t.waits.map((w) => w.ref),
	);
	expect(refs.sort()).toEqual(["link:w1", "link:w3"]);
});

test("an old link to another organization's task never names that organization's holders", () => {
	const { db, repo } = waiting();
	db.prepare(
		"insert into sessions (id, kind, cwd, name, run_state, generation, source, updated_at) values ('stranger', 'root', ?, 'Stranger', 'idle', 1, 'test', 0)",
	).run(repo);
	db.prepare(
		"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, opened_at) values ('theirs', '/x', '/x', 'stranger', 0, 'task:theirs', 0)",
	).run();
	db.prepare(
		"insert into assignments (person, task_id, assigned_by, assigned_at) values ('stranger', 'theirs', 'stranger', 0)",
	).run();
	db.prepare(
		"insert into links (id, from_kind, from_id, to_kind, to_id, relation, recorded_by, inferred, created_at) values ('old', 'task', 'theirs', 'person', 'bo', 'blocks', 'ada', 0, ?)",
	).run(HOUR);
	const wait = waitsIn(db, "boss", { cwd: repo, to: 4 * HOUR })
		.targets.flatMap((t) => t.waits)
		.find((w) => w.ref === "link:old")!;
	expect(wait.waiters).toEqual(["person:ada"]);
});

test("two people without a manager are not one team, and a trailing slash names the same area", () => {
	const { db, repo } = waiting();
	db.prepare(
		"insert into links (id, from_kind, from_id, to_kind, to_id, relation, recorded_by, inferred, created_at) values ('ghosted', 'person', 'ghost', 'person', 'boss', 'requires_decision', 'boss', 0, ?)",
	).run(HOUR);
	const wait = waitsIn(db, "boss", { cwd: repo, to: 4 * HOUR })
		.targets.flatMap((t) => t.waits)
		.find((w) => w.ref === "link:ghosted")!;
	expect(wait.crossesTeams).toBe(true);
	expect(expertsOn(db, "boss", "components/session-state/", { cwd: repo })).toEqual(
		expertsOn(db, "boss", "components/session-state", { cwd: repo }),
	);
});
