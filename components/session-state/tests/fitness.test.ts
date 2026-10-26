import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { type EconomicEvent, evaluate, realizedFitness } from "../src/fitness.js";
import { waitsIn } from "../src/inspect.js";
import { recordLink, resolveLink } from "../src/links.js";
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
	const event = (at: number, session: string, type: string, data: unknown = {}) =>
		db
			.prepare("insert into events (at, source, session_id, type, data) values (?, 'runtime', ?, ?, ?)")
			.run(at, session, type, JSON.stringify(data));
	return { db, dir, task, event };
}

test("incurred link impacts count once at their time, with recorder provenance; estimates remain evidence", () => {
	const { db, task } = organization();
	task("original", "Value: $50", 0, { at: HOUR, status: "done" });
	task("fix", "Value: $30", HOUR, { at: 3 * HOUR, status: "done" }, ["dev"]);
	const fixes = { from: { kind: "task", id: "fix" }, to: { kind: "task", id: "original" }, relation: "fixes" };
	recordLink(db, "damage", "dev", { ...fixes, data: { impact: { dollars: -120, kind: "incurred" } } }, 2 * HOUR);
	recordLink(db, "estimate", "dev", { ...fixes, data: { impact: { dollars: -500, kind: "estimated" } } }, 2 * HOUR);
	recordLink(
		db,
		"gain",
		"dev",
		{ ...fixes, relation: "produced", data: { impact: { dollars: 10, kind: "incurred", at: 3 * HOUR } } },
		2 * HOUR,
	);
	const whole = realizedFitness(db, "root", 0, 4 * HOUR);
	expect(whole).toMatchObject({ total: -30, value: 80, impact: -110 });
	expect(whole.impacts).toEqual(
		expect.arrayContaining([
			expect.objectContaining({
				link: "link:damage",
				recordedBy: "person:dev",
				dollars: -120,
				kind: "incurred",
				at: 2 * HOUR,
			}),
			expect.objectContaining({ link: "link:estimate", recordedBy: "person:dev", dollars: -500, kind: "estimated" }),
		]),
	);
	expect(whole.contributions).toContainEqual(expect.objectContaining({ source: "link:damage", impact: -120 }));
	for (const split of [HOUR, 2 * HOUR, 3 * HOUR])
		expect(realizedFitness(db, "root", 0, split).total + realizedFitness(db, "root", split, 4 * HOUR).total).toBe(
			whole.total,
		);
	expect(realizedFitness(db, "root", 0, 2 * HOUR).impact).toBe(0);
	expect(realizedFitness(db, "root", 2 * HOUR, 3 * HOUR).impact).toBe(-120);
});

test("backdated impacts restate their own window even when the link was recorded later", () => {
	const { db } = organization();
	recordLink(
		db,
		"backdated",
		"dev",
		{
			from: { kind: "check", id: "check" },
			to: { kind: "file", id: "file" },
			relation: "verifies",
			data: { impact: { dollars: -120, kind: "incurred", at: HOUR } },
		},
		3 * HOUR,
	);
	expect(realizedFitness(db, "root", 0, 2 * HOUR).total).toBe(-120);
	expect(realizedFitness(db, "root", 2 * HOUR, 4 * HOUR).total).toBe(0);
	expect(realizedFitness(db, "root", 0, 4 * HOUR).total).toBe(-120);
});

test("fixes and supersedes alone leave earned value unchanged and unreadable impact shapes are not charged", () => {
	const { db, task } = organization();
	task("original", "Value: $50", 0, { at: HOUR, status: "done" });
	task("fix", "Value: $30", HOUR, { at: 3 * HOUR, status: "done" });
	for (const [id, relation, data] of [
		["fix", "fixes", undefined],
		["replace", "supersedes", undefined],
		["string", "fixes", { impact: { dollars: "-120", kind: "incurred" } }],
		["unknown", "fixes", { impact: { dollars: -120, kind: "guess" } }],
		["bad-time", "fixes", { impact: { dollars: -120, kind: "incurred", at: "yesterday" } }],
		["other-data", "fixes", { dollars: -120 }],
	] as const)
		recordLink(
			db,
			id,
			"dev",
			{ from: { kind: "task", id: "fix" }, to: { kind: "task", id: "original" }, relation, data },
			2 * HOUR,
		);
	expect(realizedFitness(db, "root", 0, 4 * HOUR)).toMatchObject({ total: 80, impact: 0, impacts: [] });
});

test("findings are grouped by task and recorder, with resolution at the cutoff, never credited as value", () => {
	const { db, task } = organization();
	task("reviewed", "Value: $50", 0, { at: HOUR, status: "done" });
	for (const id of ["accepted", "rejected", "later"])
		recordLink(
			db,
			id,
			"dev",
			{ from: { kind: "check", id: "review" }, to: { kind: "task", id: "reviewed" }, relation: "finds" },
			2 * HOUR,
		);
	resolveLink(db, "lead", "accepted", "accepted", 3 * HOUR);
	resolveLink(db, "lead", "rejected", "rejected", 3 * HOUR);
	resolveLink(db, "lead", "later", "accepted", 4 * HOUR);
	const fitness = realizedFitness(db, "root", 0, 3 * HOUR);
	expect(fitness.total).toBe(50);
	const findings = [
		{ link: "link:accepted", task: "task:reviewed", person: "person:dev", resolution: "accepted" },
		{ link: "link:later", task: "task:reviewed", person: "person:dev", resolution: null },
		{ link: "link:rejected", task: "task:reviewed", person: "person:dev", resolution: "rejected" },
	];
	expect(fitness.findings).toEqual({
		byTask: [{ task: "task:reviewed", findings }],
		byPerson: [{ person: "person:dev", findings }],
	});
	expect(realizedFitness(db, "root", 0, 2 * HOUR).findings.byTask).toEqual([]);
	expect(realizedFitness(db, "root", 3 * HOUR, 4 * HOUR).findings.byTask).toEqual([]);
	expect(realizedFitness(db, "root", 0, 3 * HOUR, { subtree: "root" }).total).toBe(50);
});

test("impact ownership follows the historical origin, not today's tree or a foreign recorder", () => {
	const { db, event } = organization();
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at) values ('other', 'root', '/', 'idle', 1, 'test', 0)",
	).run();
	recordLink(
		db,
		"origin",
		"dev",
		{
			from: { kind: "check", id: "check" },
			to: { kind: "file", id: "file" },
			relation: "verifies",
			data: { impact: { dollars: -120, kind: "incurred" } },
		},
		HOUR,
	);
	db.prepare("update links set recorded_by = 'other' where id = 'origin'").run();
	expect(realizedFitness(db, "other", 0, 2 * HOUR).impact).toBe(0);
	db.prepare("update sessions set reports_to = 'other' where id = 'root'").run();
	event(3 * HOUR, "root", "reports_to_changed", { from: null, to: "other" });
	expect(realizedFitness(db, "other", 0, 2 * HOUR).impact).toBe(0);
	expect(realizedFitness(db, "root", 0, 2 * HOUR).impact).toBe(-120);
	expect(realizedFitness(db, "root", 0, 2 * HOUR, { subtree: "dev" })).toMatchObject({
		total: -120,
		contributions: [],
		impacts: [],
	});
});

test("joining brings outstanding obligations forward without rewriting earlier windows, even after retirement", () => {
	const { db, dir, task, event } = organization();
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at) values ('adopter', 'root', '/', 'idle', 1, 'test', 0)",
	).run();
	task("done", "Value: $50", 0, { at: HOUR, status: "done" });
	task("ongoing", "Value: $20\nCost of delay: $5/hour", 0);
	for (const [id, resolved] of [
		["done", HOUR],
		["ongoing", null],
	] as const)
		db.prepare(
			"insert into links (id, from_kind, from_id, to_kind, to_id, relation, recorded_by, inferred, created_at, resolved_at) values (?, 'task', ?, 'person', 'dev', 'requires_decision', 'dev', 0, 0, ?)",
		).run(id, id, resolved);
	const past = () => ({
		fitness: realizedFitness(db, "adopter", 0, 4 * HOUR),
		waits: waitsIn(db, "adopter", { cwd: dir, from: 0, to: 4 * HOUR }),
	});
	expect(past().fitness).toMatchObject({ value: 0, delay: 0, coverage: { tasks: 0 } });
	db.prepare("update sessions set reports_to = 'adopter' where id = 'root'").run();
	event(5 * HOUR, "root", "reports_to_changed", { from: null, to: "adopter" });
	expect(past().fitness).toMatchObject({ value: 0, delay: 0, coverage: { tasks: 0 }, openWaits: [] });
	expect(past().waits).toMatchObject({ open: 0, unblocked: [] });
	expect(realizedFitness(db, "adopter", 0, 6 * HOUR)).toMatchObject({
		value: 0,
		delay: 5,
		coverage: { tasks: 1 },
		delayByState: { waiting: 5 },
	});
	expect(waitsIn(db, "adopter", { cwd: dir, from: 0, to: 6 * HOUR })).toMatchObject({ open: 1, unblocked: [] });
	event(7 * HOUR, "root", "retired");
	expect(realizedFitness(db, "adopter", 7 * HOUR, 8 * HOUR).delay).toBe(5);
	expect(waitsIn(db, "adopter", { cwd: dir, to: 8 * HOUR }).open).toBe(1);
	db.prepare("update work_tasks set archived_at = ?, close_status = 'done' where id = 'ongoing'").run(6 * HOUR);
	expect(realizedFitness(db, "adopter", 6 * HOUR, 7 * HOUR).value).toBe(20);
	expect(realizedFitness(db, "adopter", 0, 6 * HOUR).value).toBe(0);
});

test("fitness reads only goal files owned during the requested window", () => {
	const { db, task, event } = organization();
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at) values ('other', 'root', '/', 'idle', 1, 'test', 0)",
	).run();
	const bundle = task("unreadable", "Value: $50", 0, { at: 8 * HOUR, status: "done" });
	renameSync(join(bundle, "task.md"), join(bundle, "saved.md"));
	mkdirSync(join(bundle, "task.md"));
	expect(realizedFitness(db, "other", 0, HOUR)).toMatchObject({ value: 0, delay: 0, coverage: { tasks: 0 } });
	db.prepare("update sessions set reports_to = 'other' where id = 'root'").run();
	event(5 * HOUR, "root", "reports_to_changed", { from: null, to: "other" });
	expect(realizedFitness(db, "other", 0, 4 * HOUR)).toMatchObject({ value: 0, delay: 0, coverage: { tasks: 0 } });
	expect(() => realizedFitness(db, "other", 5 * HOUR, 6 * HOUR)).toThrowError(
		expect.objectContaining({ code: "EISDIR" }),
	);
	expect(realizedFitness(db, "other", 9 * HOUR, 10 * HOUR).coverage.tasks).toBe(0);
});

test("open waits survive a source task's cancellation and its recorder's retirement", () => {
	const { db, dir, task, event } = organization();
	task("cancelled", "Value: $50", 0, { at: HOUR, status: "cancelled" });
	db.prepare(
		"insert into links (id, from_kind, from_id, to_kind, to_id, relation, recorded_by, inferred, created_at) values ('pending', 'task', 'cancelled', 'person', 'lead', 'requires_decision', 'dev', 0, 0)",
	).run();
	event(2 * HOUR, "dev", "retired");
	const fitness = realizedFitness(db, "root", 3 * HOUR, 4 * HOUR);
	expect(fitness.coverage.tasks).toBe(0);
	expect(fitness.openWaits.map((wait) => wait.id)).toEqual(["pending"]);
	expect(waitsIn(db, "root", { cwd: dir, from: 3 * HOUR, to: 4 * HOUR }).open).toBe(1);
});

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

test("the worked example with compute: windows still add up", () => {
	const { db, task, event } = organization();
	task("flaky", "Value: $50\nCost of delay: $5/hour", 0, { at: 3.5 * HOUR, status: "done" });
	event(1 * HOUR, "dev", "cost_changed", { from: 0, to: 3 });
	event(3 * HOUR, "dev", "cost_changed", { from: 3, to: 5 });
	const first = realizedFitness(db, "root", 0, 2 * HOUR);
	const second = realizedFitness(db, "root", 2 * HOUR, 4 * HOUR);
	expect(first.total).toBeCloseTo(-13, 9);
	expect(second.total).toBeCloseTo(40.5, 9);
	expect(realizedFitness(db, "root", 0, 4 * HOUR).total).toBeCloseTo(27.5, 9);
});

test("compute counts only while the spender was a member, and never the spend it brought along", () => {
	const { db, event } = organization();
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to) values ('joiner', 'root', '/', 'idle', 1, 'test', 0, 'lead')",
	).run();
	event(1 * HOUR, "joiner", "cost_changed", { from: 0, to: 5 }); // its own organization then
	event(2 * HOUR, "joiner", "reports_to_changed", { from: null, to: "lead" });
	event(3 * HOUR, "joiner", "cost_changed", { from: 5, to: 9 });
	event(4 * HOUR, "joiner", "retired", { reason: "done" });
	event(5 * HOUR, "joiner", "cost_changed", { from: 9, to: 16 });
	event(6 * HOUR, "joiner", "rehired");
	event(7 * HOUR, "joiner", "cost_changed", { from: 16, to: 18 });
	event(3.5 * HOUR, "dev", "cost_changed", { from: 0, to: 100, hello: true });
	event(3.6 * HOUR, "dev", "cost_changed", { from: 100, to: 101 });
	const result = realizedFitness(db, "root", 0, 8 * HOUR);
	expect(result.compute).toBeCloseTo(4 + 2 + 1, 9);
	const perPerson = result.contributions.filter((c) => c.source.startsWith("person:"));
	expect(perPerson.map((c) => [c.source, c.compute]).sort()).toEqual([
		["person:dev", 1],
		["person:joiner", 6],
	]);
	expect(perPerson.reduce((sum, c) => sum + c.compute, 0)).toBeCloseTo(result.compute, 9);
});

test("a report counts only once its whole chain has joined: a former root brings its team without their past", () => {
	const { db, event } = organization();
	const add = (id: string, manager: string) =>
		db
			.prepare(
				"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to) values (?, 'root', '/', 'idle', 1, 'test', 0, ?)",
			)
			.run(id, manager);
	add("other", "lead");
	add("helper", "other");
	event(1 * HOUR, "helper", "reports_to_changed", { from: null, to: "other" }); // joins its old root
	event(3 * HOUR, "helper", "cost_changed", { from: 0, to: 4 }); // spent in the other organization
	event(5 * HOUR, "other", "reports_to_changed", { from: null, to: "lead" }); // the old root joins this one
	event(6 * HOUR, "helper", "cost_changed", { from: 4, to: 6 });
	expect(realizedFitness(db, "root", 0, 8 * HOUR).compute).toBeCloseTo(2, 9);
});

test("a later move inside the organization never rewrites earlier spend", () => {
	const { db, event } = organization();
	const add = (id: string, manager: string) =>
		db
			.prepare(
				"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to) values (?, 'root', '/', 'idle', 1, 'test', 0, ?)",
			)
			.run(id, manager);
	add("mover", "newlead");
	add("newlead", "root");
	event(1 * HOUR, "mover", "reports_to_changed", { from: null, to: "root" });
	event(3 * HOUR, "mover", "cost_changed", { from: 0, to: 4 });
	event(5 * HOUR, "newlead", "reports_to_changed", { from: null, to: "root" });
	event(7 * HOUR, "mover", "transferred", { from: "root", to: "newlead", by: "root" });
	expect(realizedFitness(db, "root", 0, 8 * HOUR).compute).toBeCloseTo(4, 9);
});

test("spend recorded before a join in the same millisecond stays outside the organization", () => {
	const { db, event } = organization();
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to) values ('joining', 'root', '/', 'idle', 1, 'test', 0, 'root')",
	).run();
	event(1, "joining", "cost_changed", { from: 0, to: 1, hello: true });
	event(100, "joining", "cost_changed", { from: 1, to: 5 });
	event(100, "joining", "reports_to_changed", { from: null, to: "root" });
	event(150, "joining", "cost_changed", { from: 5, to: 6 });
	expect(realizedFitness(db, "root", 0, 200).compute).toBeCloseTo(1, 9);
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
	for (const id of ["step", "shared"])
		db.prepare(
			"insert into links (id, from_kind, from_id, to_kind, to_id, relation, recorded_by, inferred, created_at) values (?, 'task', ?, 'person', 'lead', 'requires_decision', 'helper', 0, 0)",
		).run(id, id);
	expect(realizedFitness(db, "root", 3 * HOUR, 4 * HOUR).openWaits.map((wait) => wait.id)).toEqual(["shared"]);
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

test("delay splits into queued, waiting, and in progress, and adds up to the task's delay", () => {
	const { db, task } = organization();
	task("staged", "Value: $20\nCost of delay: $5/hour", 0, { at: 3 * HOUR, status: "done" });
	db.prepare(
		"insert into links (id, from_kind, from_id, to_kind, to_id, relation, recorded_by, inferred, created_at, resolved_at) values ('w', 'task', 'staged', 'person', 'lead', 'requires_decision', 'dev', 0, ?, ?)",
	).run(HOUR, 2 * HOUR);
	db.prepare(
		"insert into assignments (person, task_id, assigned_by, assigned_at) values ('dev', 'staged', 'lead', ?)",
	).run(2 * HOUR);
	const result = realizedFitness(db, "root", 0, 4 * HOUR);
	expect(result.delay).toBeCloseTo(15, 9);
	expect(result.delayByState).toEqual({ queued: 5, waiting: 5, inProgress: 5 });
	const [staged] = result.contributions.filter((c) => c.source === "task:staged");
	expect(staged.delayByState).toEqual({ queued: 5, waiting: 5, inProgress: 5 });
	const halves = [realizedFitness(db, "root", 0, 1.5 * HOUR), realizedFitness(db, "root", 1.5 * HOUR, 4 * HOUR)];
	expect(halves[0].delayByState.waiting + halves[1].delayByState.waiting).toBeCloseTo(5, 9);
});

test("open waits show with their age, and several waits charge a task's delay once", () => {
	const { db, task } = organization();
	task("blocked", "Value: $20\nCost of delay: $2/hour", 0, undefined, ["dev"]);
	const wait = (id: string, resolved: number | null) =>
		db
			.prepare(
				"insert into links (id, from_kind, from_id, to_kind, to_id, relation, recorded_by, inferred, created_at, resolved_at) values (?, 'task', 'blocked', 'person', 'lead', 'blocks', 'dev', 0, ?, ?)",
			)
			.run(id, HOUR, resolved);
	const before = realizedFitness(db, "root", 0, 4 * HOUR).total;
	wait("a", null);
	wait("b", null);
	wait("c", null);
	wait("d", 2 * HOUR);
	const result = realizedFitness(db, "root", 0, 4 * HOUR);
	expect(result.total).toBeCloseTo(before, 9);
	expect(result.openWaits.map((w) => [w.id, w.ageHours])).toEqual([
		["a", 3],
		["b", 3],
		["c", 3],
	]);
});

test("interruptions count members' questions and mail to the operator, never the operator's own or a stranger's", () => {
	const { db, event } = organization();
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at) values ('stranger', 'root', '/', 'idle', 1, 'test', 0)",
	).run();
	event(1 * HOUR, "dev", "prompt_opened", { from: null, to: { kind: "questionnaire" } });
	event(2 * HOUR, "lead", "prompt_opened", { from: null, to: { kind: "questionnaire" } });
	event(9 * HOUR, "dev", "prompt_opened", { from: null, to: { kind: "questionnaire" } });
	event(1 * HOUR, "stranger", "prompt_opened", { from: null, to: { kind: "questionnaire" } });
	const thread = (id: string, subject: string, messages: [string, number][]) => {
		db.prepare("insert into threads (id, kind, subject, created_by, created_at) values (?, 'mail', ?, ?, 0)").run(
			id,
			subject,
			messages[0][0],
		);
		db.prepare(
			"insert into thread_participants (thread_id, participant, delivery, read_up_to, joined_at) values (?, 'operator', 'push', 0, 0)",
		).run(id);
		for (const [sender, at] of messages)
			db.prepare("insert into thread_messages (id, thread_id, sender, body, at) values (?, ?, ?, 'x', ?)").run(
				`${id}-${at}-${sender}`,
				id,
				sender,
				at,
			);
	};
	thread("esc", "Escalation", [["lead", 3 * HOUR]]);
	thread("mail", "Release", [
		["dev", 4 * HOUR],
		["operator", 5 * HOUR],
		["stranger", 5 * HOUR],
	]);
	const result = realizedFitness(db, "root", 0, 8 * HOUR);
	expect(result.interruptions).toBe(4);
	expect(result.attention).toEqual({ pricePerMinute: 1, measured: false });
	expect(result.total).toBe(realizedFitness(db, "root", 0, 8 * HOUR).total);
});

test("a later join never pulls a newcomer's earlier questions or waits into a past window", () => {
	const { db, event } = organization();
	db.prepare(
		"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to) values ('joining', 'root', '/', 'idle', 1, 'test', 0, 'root')",
	).run();
	event(1 * HOUR, "joining", "prompt_opened", { from: null, to: { kind: "questionnaire" } });
	db.prepare(
		"insert into links (id, from_kind, from_id, to_kind, to_id, relation, recorded_by, inferred, created_at) values ('w', 'person', 'joining', 'person', 'lead', 'requires_decision', 'joining', 0, ?)",
	).run(HOUR);
	event(5 * HOUR, "joining", "reports_to_changed", { from: null, to: "root" });
	const past = realizedFitness(db, "root", 0, 4 * HOUR);
	expect(past.interruptions).toBe(0);
	expect(past.openWaits).toEqual([]);
	expect(realizedFitness(db, "root", 0, 6 * HOUR).openWaits.map((w) => w.id)).toEqual(["w"]);
});

test("a message counts as an interruption only if the operator was in its thread when it was sent", () => {
	const { db } = organization();
	db.prepare(
		"insert into threads (id, kind, subject, created_by, created_at) values ('t', 'mail', 'Plan', 'dev', 0)",
	).run();
	db.prepare(
		"insert into thread_participants (thread_id, participant, delivery, read_up_to, joined_at) values ('t', 'operator', 'push', 0, ?)",
	).run(5 * HOUR);
	db.prepare("insert into thread_messages (id, thread_id, sender, body, at) values ('early', 't', 'dev', 'x', ?)").run(
		HOUR,
	);
	db.prepare("insert into thread_messages (id, thread_id, sender, body, at) values ('late', 't', 'dev', 'x', ?)").run(
		6 * HOUR,
	);
	expect(realizedFitness(db, "root", 0, 4 * HOUR).interruptions).toBe(0);
	expect(realizedFitness(db, "root", 0, 8 * HOUR).interruptions).toBe(1);
});
