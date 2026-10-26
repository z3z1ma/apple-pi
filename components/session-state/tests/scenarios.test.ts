import { mkdirSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test } from "vitest";
import { realizedFitness } from "../src/fitness.js";
import { recordLink } from "../src/links.js";
import { compareScenarios, predictions, type Scenario } from "../src/scenarios.js";
import { migrate } from "../src/schema.js";
import { postToThread } from "../src/threads.js";
import { changeWork } from "../src/work.js";

const HOUR = 3_600_000;
function forecast(): Scenario {
	return {
		name: "No reviewer",
		decisionAt: "recording",
		horizonMs: 2 * HOUR,
		organization: "One builder",
		opportunities: [{ id: "change", taskId: "change", value: 300, costOfDelayPerHour: 0 }],
		start: [],
		outcomes: [
			{
				probability: 1,
				tasks: [{ opportunity: "change", openedMs: 0, closedMs: HOUR, status: "done" }],
				compute: [{ atMs: 0, dollars: 10 }],
				impacts: [],
			},
		],
	};
}
function fixture() {
	const dir = mkdtempSync(join(tmpdir(), "apple-pi-scenarios-"));
	const db = new DatabaseSync(join(dir, "state.db"));
	migrate(db);
	for (const [id, manager] of [
		["root", null],
		["dev", "root"],
		["other", null],
	])
		db.prepare(
			"insert into sessions (id, kind, cwd, run_state, generation, source, updated_at, reports_to) values (?, 'root', ?, 'idle', 1, 'test', 0, ?)",
		).run(id, dir, manager);
	db.prepare(
		"insert into threads (id, kind, subject, created_by, created_at) values ('forecast-thread', 'mail', 'Forecast', 'dev', 0)",
	).run();
	db.prepare(
		"insert into thread_messages (id, thread_id, sender, body, at) values ('mutation', 'forecast-thread', 'dev', 'Proposed change', 0)",
	).run();
	const task = (id = "change", header = "Value: $300", organization = "root", opened = 0, closed = HOUR) => {
		const bundle = join(dir, id);
		mkdirSync(bundle);
		writeFileSync(join(bundle, "task.md"), `${header}\n# ${id}\n`);
		db.prepare(
			"insert into work_tasks (id, bundle, project, organization, ephemeral, thread, opened_at, archived_at, close_status) values (?, ?, ?, ?, 0, ?, ?, ?, 'done')",
		).run(id, bundle, dir, organization, `task:${id}`, opened, closed);
		return bundle;
	};
	const record = (id: string, scenario: unknown, at = 0, target = "root") =>
		recordLink(
			db,
			id,
			target === "root" ? "dev" : "other",
			{
				from: { kind: "message", id: "mutation" },
				to: { kind: "organization", id: target },
				relation: "predicts",
				data: { scenario, note: "preserved" },
			},
			at,
		);
	const event = (at: number, person: string, type: string, data: unknown) =>
		db
			.prepare("insert into events (at, source, session_id, type, data) values (?, 'runtime', ?, ?, ?)")
			.run(at, person, type, JSON.stringify(data));
	return { db, dir, task, record, event };
}

test("review changes the weighted outcomes from $200 to $254 through the same U", () => {
	const builder = forecast();
	builder.outcomes[0].probability = 0.7;
	builder.outcomes.push({
		...structuredClone(builder.outcomes[0]),
		probability: 0.3,
		impacts: [{ atMs: HOUR, dollars: -300 }],
	});
	const reviewer = structuredClone(builder);
	reviewer.name = "With reviewer";
	reviewer.organization = "Builder and reviewer";
	reviewer.outcomes[0].probability = 0.9;
	reviewer.outcomes[1].probability = 0.1;
	for (const outcome of reviewer.outcomes) outcome.compute[0].dollars = 16;
	const result = compareScenarios([builder, reviewer], 42);
	expect(result.scenarios.map((scenario) => scenario.expected)).toEqual([200, 254]);
	expect(result.scenarios.map((scenario) => scenario.outcomes.map((outcome) => outcome.total))).toEqual([
		[290, -10],
		[284, -16],
	]);
	expect(result.scenarios.map((scenario) => scenario.decisionAt)).toEqual([42, 42]);
});

test("a full observed history echoes exactly in the scenario adapter, including carryover delay, compute and impacts", () => {
	const { db, task, event } = fixture();
	task("change", "Value: $300\nCost of delay: $5/hour", "root", -HOUR, HOUR);
	event(0, "dev", "cost_changed", { from: 0, to: 10 });
	recordLink(
		db,
		"damage",
		"dev",
		{
			from: { kind: "check", id: "outcome" },
			to: { kind: "task", id: "change" },
			relation: "finds",
			data: { impact: { kind: "incurred", dollars: -20, at: HOUR } },
		},
		HOUR,
	);
	const scenario = forecast();
	scenario.opportunities[0].costOfDelayPerHour = 5;
	scenario.start = [{ opportunity: "change", openedMs: -HOUR }];
	scenario.outcomes[0].tasks[0].openedMs = -HOUR;
	scenario.outcomes[0].impacts = [{ atMs: HOUR, dollars: -20 }];
	const expected = compareScenarios([scenario], 0).scenarios[0];
	const observed = realizedFitness(db, "root", 0, 2 * HOUR);
	expect(expected.expected).toBe(observed.total);
	expect(expected.outcomes[0]).toMatchObject({ total: 265, value: 300, delay: 5, compute: 10, impact: -20 });
	expect(expected.outcomes[0]).not.toHaveProperty("delayByState");
	for (const contribution of expected.outcomes[0].contributions)
		expect(contribution).not.toHaveProperty("delayByState");
});

test("U endpoints handle closed initial history once, horizon clipping and unpursued opportunities", () => {
	const scenario = forecast();
	scenario.opportunities = ["at-zero", "before", "cancelled", "late", "open", "unselected"].map((id) => ({
		id,
		value: 10,
		costOfDelayPerHour: 2,
	}));
	scenario.start = [
		{ opportunity: "at-zero", openedMs: -HOUR, closedMs: 0, status: "done" },
		{ opportunity: "before", openedMs: -HOUR, closedMs: -1, status: "done" },
		{ opportunity: "cancelled", openedMs: -HOUR, closedMs: 0, status: "cancelled" },
		{ opportunity: "open", openedMs: -HOUR },
	];
	scenario.outcomes[0] = {
		probability: 1,
		tasks: [...scenario.start, { opportunity: "late", openedMs: 0, closedMs: 3 * HOUR, status: "done" }],
		compute: [{ atMs: 2 * HOUR, dollars: 100 }],
		impacts: [{ atMs: 2 * HOUR, dollars: -100 }],
	};
	const result = compareScenarios([scenario], 0).scenarios[0];
	expect(result.outcomes[0]).toMatchObject({ value: 10, delay: 8, compute: 0, impact: 0, total: 2 });
	const boundary = forecast();
	boundary.outcomes[0].tasks[0].closedMs = 2 * HOUR;
	expect(compareScenarios([boundary], 0).scenarios[0].outcomes[0].value).toBe(0);
});

test.each([
	[
		"decision point",
		(scenario: Scenario) => {
			scenario.decisionAt = 1;
		},
	],
	[
		"horizon",
		(scenario: Scenario) => {
			scenario.horizonMs++;
		},
	],
	[
		"opportunities",
		(scenario: Scenario) => {
			scenario.opportunities[0].taskId = "different";
		},
	],
	[
		"valuations",
		(scenario: Scenario) => {
			scenario.opportunities[0].value++;
		},
	],
	[
		"valuations",
		(scenario: Scenario) => {
			scenario.opportunities[0].costOfDelayPerHour++;
		},
	],
	[
		"starting work state",
		(scenario: Scenario) => {
			scenario.start = [{ opportunity: "change", openedMs: 0 }];
		},
	],
] as const)("comparison names differing %s", (dimension, change) => {
	const first = forecast();
	const second = forecast();
	change(second);
	expect(() => compareScenarios([first, second], 0)).toThrow(dimension);
});

test("canonical equality uses exact opaque IDs even when locale collation treats distinct Unicode spellings as equal", () => {
	const first = forecast();
	first.opportunities = ["\u00e9", "e\u0301"].map((id) => ({ id, value: 1, costOfDelayPerHour: 0 }));
	first.start = first.opportunities.map(({ id }) => ({ opportunity: id, openedMs: 0 }));
	first.outcomes[0].tasks = [...first.start];
	const second = structuredClone(first);
	second.opportunities.reverse();
	second.start.reverse();
	second.outcomes[0].tasks.reverse();
	expect(compareScenarios([first, second], 0).scenarios).toHaveLength(2);
});

test("canonical comparison ignores opportunity/start array ordering and descriptive organization/evidence", () => {
	const first = forecast();
	first.opportunities.push({ id: "other", value: 10, costOfDelayPerHour: 0 });
	first.start = [
		{ opportunity: "change", openedMs: 0 },
		{ opportunity: "other", openedMs: -1, closedMs: -1, status: "cancelled" },
	];
	first.outcomes[0].tasks.push(first.start[1]);
	const second = structuredClone(first);
	second.opportunities.reverse();
	second.start.reverse();
	second.organization = "A different team";
	second.evidence = ["link:evidence"];
	second.decisionAt = 42;
	expect(compareScenarios([first, second], 42).scenarios).toHaveLength(2);
});

test.each([
	(s: Scenario) => {
		s.outcomes[0].probability = 0.9;
	},
	(s: Scenario) => {
		s.outcomes[0].probability = Number.NaN;
	},
	(s: Scenario) => {
		s.horizonMs = Number.POSITIVE_INFINITY;
	},
	(s: Scenario) => {
		s.outcomes[0].compute[0].dollars = -1;
	},
	(s: Scenario) => {
		s.opportunities.push(s.opportunities[0]);
	},
	(s: Scenario) => {
		s.outcomes[0].tasks.push(s.outcomes[0].tasks[0]);
	},
	(s: Scenario) => {
		s.outcomes[0].tasks[0].opportunity = "unknown";
	},
	(s: Scenario) => {
		s.outcomes[0].tasks[0].closedMs = -1;
	},
	(s: Scenario) => {
		delete s.outcomes[0].tasks[0].status;
	},
	(s: Scenario) => {
		s.start = [{ opportunity: "change", openedMs: 1 }];
	},
	(s: Scenario) => {
		s.start = [{ opportunity: "change", openedMs: 0 }];
		s.outcomes[0].tasks = [];
	},
	(s: Scenario) => {
		s.start = [{ opportunity: "change", openedMs: -1 }];
	},
	(s: Scenario) => {
		s.start = [{ opportunity: "change", openedMs: 0, closedMs: 0, status: "done" }];
	},
])("invalid probabilities, numbers and incomplete/reopened histories are refused (%#)", (change) => {
	const scenario = forecast();
	change(scenario);
	expect(() => compareScenarios([scenario], 0)).toThrow();
});

test("prediction data and binding time survive generic link replay, then mature at the exact endpoint", () => {
	const { db, task, record, event } = fixture();
	task();
	event(0, "dev", "cost_changed", { from: 0, to: 10 });
	const scenario = forecast();
	record("forecast", scenario);
	const raw = (db.prepare("select data from links where id = 'forecast'").get() as { data: string }).data;
	record("forecast", { wrong: "replayed" }, HOUR);
	expect(JSON.parse(raw)).toEqual({ scenario, note: "preserved" });
	expect(db.prepare("select data, created_at from links where id = 'forecast'").get()).toEqual({
		data: raw,
		created_at: 0,
	});
	expect(predictions(db, "root", 2 * HOUR - 1)[0]).toMatchObject({
		status: "pending",
		expected: 290,
		forecastError: null,
	});
	expect(predictions(db, "root", 2 * HOUR - 1)[0].observed).toBeUndefined();
	expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({
		status: "observed",
		expected: 290,
		observed: 290,
		forecastError: 0,
		recordedAt: 0,
		raw,
	});
});

test("incomplete observed work keeps its total and coverage visible but withholds numerical calibration", () => {
	const { db, task, record } = fixture();
	task();
	task("unpriced", "No value yet");
	const scenario = forecast();
	scenario.outcomes[0].compute = [];
	record("forecast", scenario);
	expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({
		expected: 300,
		observed: 300,
		forecastError: null,
		reason: "observed fitness incomplete",
		observation: {
			incomplete: true,
			coverage: { tasks: 2, unvalued: 1 },
			excludes: expect.stringContaining("pi_exec"),
			attention: { measured: false },
		},
	});
});

test("known measurement exclusions stay disclosed without making an otherwise complete observation unscorable", () => {
	const { db, task, record } = fixture();
	task();
	const scenario = forecast();
	scenario.outcomes[0].compute = [];
	record("forecast", scenario);
	expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({
		observed: 300,
		forecastError: 0,
		observation: {
			incomplete: false,
			coverage: { tasks: 1, unvalued: 0 },
			excludes: expect.stringContaining("pi_exec"),
			attention: { measured: false },
		},
	});
});

test("finite forecast and observation totals cannot emit an overflowing calibration error", () => {
	const { db, task, record } = fixture();
	task("change", "Value: $1e308");
	const scenario = forecast();
	scenario.opportunities[0].value = 1e308;
	scenario.outcomes[0].tasks = [];
	scenario.outcomes[0].compute[0].dollars = 1e308;
	record("forecast", scenario);
	expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({
		expected: -1e308,
		observed: 1e308,
		forecastError: null,
		reason: "forecast error non-finite",
	});
});

test("an overflowing actual total is explicitly unavailable rather than serialized as an unexplained null", () => {
	const { db, task, record } = fixture();
	task("change", "Value: $1e308 (estimated by dev)");
	task("extra", "Value: $1e308 (estimated by dev)");
	const scenario = forecast();
	scenario.opportunities[0].value = 1e308;
	scenario.outcomes[0].tasks = [];
	scenario.outcomes[0].compute = [];
	record("forecast", scenario);
	expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({
		expected: 0,
		observed: null,
		forecastError: null,
		reason: "observed fitness non-finite",
		observation: {
			incomplete: false,
			coverage: { tasks: 2, estimatedValueShare: null, unattributedValueShare: null },
			coverageReason: "coverage metadata non-finite",
		},
	});
});

test("nonfinite coverage shares are explicit metadata limits, not a reason to suppress otherwise finite calibration", () => {
	const { db, task, record } = fixture();
	task("change", "Value: $1e308 (estimated by dev)", "root", 0, 4 * HOUR);
	task("extra", "Value: $1e308 (estimated by dev)", "root", 0, 4 * HOUR);
	const scenario = forecast();
	scenario.opportunities[0].value = 1e308;
	scenario.outcomes[0].tasks = [];
	scenario.outcomes[0].compute = [];
	record("forecast", scenario);
	expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({
		observed: 0,
		forecastError: 0,
		observation: {
			incomplete: false,
			coverage: { tasks: 2, unvalued: 0, estimatedValueShare: null, unattributedValueShare: null },
			coverageReason: "coverage metadata non-finite",
		},
	});
});

test("bound horizons must advance representably at preview and recording origins, without a fixed minimum", () => {
	const { db, record } = fixture();
	const scenario = forecast();
	scenario.horizonMs = 0.000001;
	expect(() => compareScenarios([scenario], 1e12)).toThrow("finite advancing interval");
	expect(compareScenarios([scenario], 0).scenarios[0].expected).toBe(-10);
	record("collapsed", scenario, 1e12);
	expect(predictions(db, "root", 1e12)[0]).toMatchObject({
		status: "unreadable",
		reason: expect.stringContaining("finite advancing interval"),
	});
	const absolute = structuredClone(scenario);
	absolute.decisionAt = 0;
	record("recording-collapsed", absolute, 1e12);
	expect(predictions(db, "root", 1e12)[1]).toMatchObject({
		status: "unreadable",
		reason: expect.stringContaining("finite advancing interval"),
	});
	const overflowing = forecast();
	overflowing.decisionAt = Number.MAX_VALUE;
	overflowing.horizonMs = Number.MAX_VALUE;
	expect(() => compareScenarios([overflowing], 0)).toThrow("finite advancing interval");
});

test("later-created task identities never upgrade the same earlier prediction from unverifiable to scored", () => {
	const { db, dir, record } = fixture();
	const scenario = forecast();
	scenario.horizonMs = 100;
	scenario.opportunities[0].taskId = "work-later";
	scenario.outcomes[0].tasks = [];
	scenario.outcomes[0].compute = [];
	record("forecast", scenario);
	expect(predictions(db, "root", 100)[0]).toMatchObject({
		observed: 0,
		forecastError: null,
		reason: "valuation unverifiable",
	});
	db.exec("begin");
	const change = changeWork(
		db,
		dir,
		"later",
		"dev",
		{ kind: "work", action: "take", cwd: dir, goal: "Later work", title: "Later", value: 300 },
		200,
		[],
		[],
	);
	expect(postToThread(db, "dev", "later:post", change.post, 200)).not.toBeTypeOf("string");
	db.exec("commit");
	expect(predictions(db, "root", 100)[0]).toMatchObject({
		observed: 0,
		forecastError: null,
		reason: "valuation unverifiable",
	});
	record("later-forecast", scenario, 200);
	expect(predictions(db, "root", 300).find((prediction) => prediction.link === "link:later-forecast")).toMatchObject({
		status: "observed",
		observed: 0,
		forecastError: 0,
	});
});

test("unknown or future recorded opening prevents goal access, while an exact recording-time tie is verifiable", () => {
	const { db, task, record } = fixture();
	const bundle = task();
	record("forecast", forecast());
	expect(predictions(db, "root", 2 * HOUR)[0].forecastError).toBe(10);
	renameSync(join(bundle, "task.md"), join(bundle, "saved.md"));
	mkdirSync(join(bundle, "task.md"));
	db.prepare("update work_tasks set archived_at = ? where id = 'change'").run(6 * HOUR);
	for (const opened of [null, 3 * HOUR]) {
		db.prepare("update work_tasks set opened_at = ? where id = 'change'").run(opened);
		expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({
			reason: "valuation unverifiable",
			forecastError: null,
		});
	}
});

test("value and delay edits suppress error separately while expected and observed remain available", () => {
	const { db, task, record } = fixture();
	const bundle = task();
	record("forecast", forecast());
	writeFileSync(join(bundle, "task.md"), "Value: $310\n# change\n");
	expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({
		reason: "valuation changed",
		expected: 290,
		observed: 310,
		forecastError: null,
	});
	writeFileSync(join(bundle, "task.md"), "Value: $300\nCost of delay: $5/hour\n# change\n");
	expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({
		reason: "valuation changed",
		observed: 295,
		forecastError: null,
	});
	writeFileSync(join(bundle, "task.md"), "Value: $300 (estimated by Different Name)\n# change\n");
	const moved = join(bundle, "moved");
	mkdirSync(moved);
	renameSync(join(bundle, "task.md"), join(moved, "task.md"));
	db.prepare("update work_tasks set bundle = ? where id = 'change'").run(moved);
	expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({ forecastError: 10 });
});

test.each(["anticipated", "missing", "missing-file", "unvalued", "foreign"])(
	"%s valuation is unverifiable without invented identity or cross-organization file access",
	(kind) => {
		const { db, task, record } = fixture();
		const scenario = forecast();
		if (kind === "anticipated") delete scenario.opportunities[0].taskId;
		if (kind === "unvalued") task("change", "No valuation");
		if (kind === "missing-file") {
			const bundle = task();
			renameSync(join(bundle, "task.md"), join(bundle, "saved.md"));
		}
		if (kind === "foreign") {
			const bundle = task("change", "Value: $300", "other");
			renameSync(join(bundle, "task.md"), join(bundle, "saved.md"));
			mkdirSync(join(bundle, "task.md"));
		}
		record("forecast", scenario);
		expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({
			reason:
				kind === "missing-file" || kind === "unvalued"
					? "valuation unverifiable; observed fitness incomplete"
					: "valuation unverifiable",
			expected: 290,
			observed: 0,
			forecastError: null,
		});
	},
);

test("a later adoption never backfills the prediction's foreign-at-recording valuation basis", () => {
	const { db, task, record, event } = fixture();
	const bundle = task("change", "Value: $300", "other", -2 * HOUR, -HOUR);
	renameSync(join(bundle, "task.md"), join(bundle, "saved.md"));
	mkdirSync(join(bundle, "task.md"));
	record("forecast", forecast());
	db.prepare("update sessions set reports_to = 'root' where id = 'other'").run();
	event(HOUR, "other", "reports_to_changed", { from: null, to: "root" });
	expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({
		reason: "valuation unverifiable",
		observed: 0,
		forecastError: null,
	});
});

test("finite inputs whose arithmetic overflows are refused rather than returned as non-numeric forecasts", () => {
	const scenario = forecast();
	scenario.outcomes[0].compute = [
		{ atMs: 0, dollars: Number.MAX_VALUE },
		{ atMs: 0, dollars: Number.MAX_VALUE },
	];
	expect(() => compareScenarios([scenario], 0)).toThrow("finite");
});

test("unselected opportunities still require verifiable valuations, and relevant I/O errors remain visible", () => {
	const { db, task, record } = fixture();
	const bundle = task();
	const scenario = forecast();
	scenario.opportunities.push({ id: "not-pursued", value: 10, costOfDelayPerHour: 0 });
	record("forecast", scenario);
	expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({ reason: "valuation unverifiable", forecastError: null });
	renameSync(join(bundle, "task.md"), join(bundle, "saved.md"));
	mkdirSync(join(bundle, "task.md"));
	expect(() => predictions(db, "root", 2 * HOUR)).toThrow();
});

test("an absolute origin matching immutable recording time is scored without shifting", () => {
	const { db, task, record } = fixture();
	task();
	const scenario = forecast();
	scenario.decisionAt = 0;
	record("aligned", scenario);
	expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({ expected: 290, observed: 300, forecastError: 10 });
});

test("absolute what-ifs with a different recording clock remain unscored without shifting raw data", () => {
	const { db, task, record } = fixture();
	task();
	const scenario = forecast();
	scenario.decisionAt = -HOUR;
	record("clock", scenario);
	expect(compareScenarios([scenario], 0).scenarios[0].decisionAt).toBe(-HOUR);
	expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({
		reason: "clock mismatch",
		expected: 290,
		observed: 300,
		forecastError: null,
	});
	expect(JSON.parse(predictions(db, "root", 2 * HOUR)[0].raw!).scenario.decisionAt).toBe(-HOUR);
});

test("a non-message predicts source remains raw unreadable evidence without restricting generic link writes", () => {
	const { db, task } = fixture();
	task();
	recordLink(
		db,
		"wrong-source",
		"dev",
		{
			from: { kind: "check", id: "mutation-check" },
			to: { kind: "organization", id: "root" },
			relation: "predicts",
			data: { scenario: forecast() },
		},
		0,
	);
	expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({
		status: "unreadable",
		reason: "Prediction source must be a message stating the change",
	});
	expect(JSON.parse(predictions(db, "root", 2 * HOUR)[0].raw!).scenario).toEqual(forecast());
});

test("malformed rows remain independently visible with raw data while valid predictions still calibrate", () => {
	const { db, task, record } = fixture();
	task();
	record("bad", { wrong: true });
	record("string", "not a scenario");
	record("good", forecast());
	const rows = predictions(db, "root", 2 * HOUR);
	expect(rows.map((row) => row.status)).toEqual(["unreadable", "observed", "unreadable"]);
	expect(rows[0].raw).toContain("wrong");
	expect(rows[2].raw).toContain("not a scenario");
	expect(rows[0].reason).toBeTruthy();
	expect(rows[1]).toMatchObject({ expected: 290, observed: 300, forecastError: 10 });
});

test("listing and observation retain the exact target across merges, with historical origin admission", () => {
	const { db, task, record, event } = fixture();
	task();
	record("original", forecast());
	db.prepare("update sessions set reports_to = 'other' where id = 'root'").run();
	event(HOUR, "root", "reports_to_changed", { from: null, to: "other" });
	expect(predictions(db, "other", 2 * HOUR)).toEqual([]);
	expect(predictions(db, "root", 2 * HOUR)[0]).toMatchObject({ target: "organization:root", observed: 300 });
	db.prepare("update links set organization = 'other' where id = 'original'").run();
	expect(predictions(db, "root", 2 * HOUR)).toEqual([]);
});
