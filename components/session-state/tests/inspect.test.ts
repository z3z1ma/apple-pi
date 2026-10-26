import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { areasOf, expertsOn } from "../src/inspect.js";
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
