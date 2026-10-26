import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { type EconomicEvent, evaluate, realizedFitness } from "../src/fitness.js";
import { migrate } from "../src/schema.js";

const HOUR = 3_600_000;

test("the evaluator adds up across any split of a window, events on a boundary counting in the later part", () => {
	const events: EconomicEvent[] = [
		{ kind: "value", at: 2 * HOUR, amount: 50, source: "task:a" },
		{ kind: "delay", from: 0, to: 3.5 * HOUR, perHour: 5, source: "task:a" },
		{ kind: "compute", at: 1.25 * HOUR, amount: 3, source: "person:p" },
		{ kind: "impact", at: 0.5 * HOUR, amount: -7, source: "link:l" },
	];
	const whole = evaluate(events, 0, 4 * HOUR).total;
	for (const split of [0.5 * HOUR, 1.7 * HOUR, 2 * HOUR, 3.5 * HOUR])
		expect(evaluate(events, 0, split).total + evaluate(events, split, 4 * HOUR).total).toBeCloseTo(whole, 9);
	expect(evaluate(events, 0, 2 * HOUR).total).toBeCloseTo(-10 - 3 - 7, 9);
	expect(evaluate(events, 2 * HOUR, 4 * HOUR).total).toBeCloseTo(50 - 7.5, 9);
});

function organization() {
	const dir = mkdtempSync(join(tmpdir(), "apple-pi-fitness-"));
	const db = new DatabaseSync(join(dir, "state.db"));
	migrate(db);
	const person = (id: string, reportsTo: string | null) =>
		db
			.prepare(
				"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to) values (?, 'root', ?, 'idle', 1, 'test', 0, ?)",
			)
			.run(id, dir, reportsTo);
	person("root", null);
	person("lead", "root");
	person("dev", "lead");
	const task = (
		id: string,
		header: string,
		opened: number,
		closed?: { at: number; status: "done" | "cancelled" },
		holders: string[] = [],
	) => {
		const bundle = join(dir, "live", id);
		mkdirSync(bundle, { recursive: true });
		writeFileSync(join(bundle, "task.md"), `Status: in-progress\n${header}\n# ${id}\n`);
		db.prepare(
			"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, opened_at, archived_at, close_status) values (?, ?, ?, 'root', 0, ?, ?, ?, ?)",
		).run(id, bundle, dir, `task:${id}`, opened, closed?.at ?? null, closed?.status ?? null);
		for (const holder of holders)
			db.prepare("insert into assignments (person, task_id, assigned_by, assigned_at) values (?, ?, 'root', ?)").run(
				holder,
				id,
				opened,
			);
		return bundle;
	};
	return { db, dir, task };
}

test("the worked example: value earned once at completion, delay from the open until the close", () => {
	const { db, task } = organization();
	task("flaky", "Value: $50 (estimated by Ada)\nCost of delay: $5/hour", 0, { at: 3.5 * HOUR, status: "done" }, [
		"dev",
		"lead",
		"root",
	]);
	const first = realizedFitness(db, "root", 0, 2 * HOUR);
	const second = realizedFitness(db, "root", 2 * HOUR, 4 * HOUR);
	expect(first).toMatchObject({ total: -10, value: 0, delay: 10 });
	expect(second).toMatchObject({ total: 42.5, value: 50, delay: 7.5 });
	expect(realizedFitness(db, "root", 0, 4 * HOUR).total).toBeCloseTo(first.total + second.total, 9);
	expect(second.perHour).toBeCloseTo(21.25, 9);
});

test("a cancelled task earns nothing and stops its delay; outstanding valued work makes an idle organization negative", () => {
	const { db, task } = organization();
	task("dropped", "Value: $100\nCost of delay: $2/hour", 0, { at: 1 * HOUR, status: "cancelled" });
	task("waiting", "Value: $30\nCost of delay: $1/hour", 0);
	const result = realizedFitness(db, "root", 0, 10 * HOUR);
	expect(result).toMatchObject({ value: 0, delay: 2 + 10 });
	expect(result.total).toBeLessThan(0);
});

test("history is the same before and after a task's bundle is archived", () => {
	const { db, dir, task } = organization();
	const bundle = task("archived", "Value: $20\nCost of delay: $4/hour", 0, { at: 2 * HOUR, status: "done" });
	const before = realizedFitness(db, "root", 0, HOUR);
	const archived = join(dir, "history", "archived");
	mkdirSync(join(dir, "history"));
	renameSync(bundle, archived);
	db.prepare("update work_tasks set bundle = ? where id = 'archived'").run(archived);
	expect(realizedFitness(db, "root", 0, HOUR)).toEqual(before);
});

test("unvalued work is counted apart from $0 work, and the share of estimated value shows", () => {
	const { db, task } = organization();
	task("guess", "Value: $30 (estimated by Ada)", 0);
	task("known", "Value: $10", 0);
	task("free", "Value: $0\nCost of delay: $5/hour", 0);
	task("blank", "", 0);
	task("blank-done", "", 0, { at: HOUR / 2, status: "done" });
	const result = realizedFitness(db, "root", 0, HOUR);
	expect(result.coverage).toEqual({
		tasks: 5,
		unvalued: 2,
		unvaluedShare: 0.4,
		outstandingUnvalued: 1,
		closedUnvalued: 1,
		estimatedValueShare: 0.75,
		unattributedValueShare: 0.25,
	});
	expect(result.incomplete).toBe(true);
	expect(result.delay).toBe(5);
});

test("an edit of a task's value restates past windows", () => {
	const { db, task } = organization();
	const bundle = task("repriced", "Value: $10", 0, { at: HOUR, status: "done" });
	expect(realizedFitness(db, "root", 0, 2 * HOUR).value).toBe(10);
	writeFileSync(join(bundle, "task.md"), "Status: done\nValue: $40\n# repriced\n");
	expect(realizedFitness(db, "root", 0, 2 * HOUR).value).toBe(40);
});

test("work held only by a program's temporary peers does not count; work they share with a member does", () => {
	const { db, task } = organization();
	db.prepare(
		"insert into program_peers (session_id, program_id, created_by, task_id) values ('helper', 'p', 'root', 'step')",
	).run();
	task("step", "Value: $45", 0, { at: HOUR, status: "done" }, ["helper"]);
	task("shared", "Value: $10", 0, { at: HOUR, status: "done" }, ["helper", "dev"]);
	db.exec("update work_tasks set ephemeral = 1");
	expect(realizedFitness(db, "root", 0, 2 * HOUR).value).toBe(10);
});

test("narrowing to a subtree lists only its people's tasks and keeps the organization's total", () => {
	const { db, task } = organization();
	task("mine", "Value: $10", 0, { at: HOUR, status: "done" }, ["dev"]);
	task("theirs", "Value: $5", 0, { at: HOUR, status: "done" }, ["root"]);
	const whole = realizedFitness(db, "root", 0, 2 * HOUR);
	const narrowed = realizedFitness(db, "root", 0, 2 * HOUR, { subtree: "lead" });
	expect(narrowed.total).toBe(whole.total);
	expect(narrowed.contributions.map((c) => c.source)).toEqual(["task:mine"]);
	expect(whole.contributions.map((c) => c.source).sort()).toEqual(["task:mine", "task:theirs"]);
});
