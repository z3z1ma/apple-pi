import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { type Static, Type } from "typebox";
import { Value } from "typebox/value";
import { type EconomicEvent, evaluate, linkOwnership, realizedFitness, taskOwnership } from "./fitness.js";
import type { Link } from "./links.js";
import { readValuation } from "./valuation.js";

const historySchema = Type.Object(
	{
		opportunity: Type.String({ minLength: 1 }),
		openedMs: Type.Number({
			description:
				"Opening offset in milliseconds from decisionAt; initial histories retain this opening in every outcome.",
		}),
		closedMs: Type.Optional(Type.Number()),
		status: Type.Optional(Type.Union([Type.Literal("done"), Type.Literal("cancelled")])),
	},
	{ additionalProperties: false },
);
const moneySchema = (nonnegative: boolean) =>
	Type.Object(
		{
			atMs: Type.Number(),
			dollars: Type.Number(nonnegative ? { minimum: 0 } : {}),
		},
		{ additionalProperties: false },
	);

export const scenarioSchema = Type.Object(
	{
		name: Type.String({ minLength: 1 }),
		decisionAt: Type.Union([Type.Number(), Type.Literal("recording")], {
			description:
				"Absolute epoch milliseconds, or recording: captured now for preview, immutable link creation for predictions.",
		}),
		horizonMs: Type.Number({ exclusiveMinimum: 0 }),
		organization: Type.String({ minLength: 1 }),
		opportunities: Type.Array(
			Type.Object(
				{
					id: Type.String({ minLength: 1 }),
					taskId: Type.Optional(Type.String({ minLength: 1 })),
					value: Type.Number({ minimum: 0 }),
					costOfDelayPerHour: Type.Number({ minimum: 0 }),
				},
				{ additionalProperties: false },
			),
		),
		start: Type.Array(historySchema, {
			description:
				"Initial complete histories: open/close offsets at or before zero. Every outcome preserves each initial opening and any already-closed state.",
		}),
		outcomes: Type.Array(
			Type.Object(
				{
					probability: Type.Number({ minimum: 0, maximum: 1 }),
					tasks: Type.Array(historySchema),
					compute: Type.Array(moneySchema(true)),
					impacts: Type.Array(moneySchema(false)),
				},
				{ additionalProperties: false },
			),
			{
				minItems: 1,
				description:
					"Nonempty weighted histories; probabilities sum to 1 without renormalization. Include all initial obligations; other declared opportunities may be pursued at/after zero or left unselected.",
			},
		),
		evidence: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
	},
	{ additionalProperties: false },
);
export type Scenario = Static<typeof scenarioSchema>;
type History = Scenario["start"][number];

function finite(...numbers: number[]) {
	if (numbers.some((number) => !Number.isFinite(number))) throw new Error("Scenario numbers must be finite");
}

function boundEnd(origin: number, horizonMs: number) {
	const end = origin + horizonMs;
	if (!Number.isFinite(origin) || !Number.isFinite(end) || end <= origin)
		throw new Error("Scenario horizon must form a finite advancing interval at its bound origin");
	return end;
}

function histories(rows: History[], declared: ReadonlySet<string>) {
	const found = new Map<string, History>();
	for (const row of rows) {
		if (!declared.has(row.opportunity)) throw new Error(`Undeclared opportunity ${row.opportunity}`);
		if (found.has(row.opportunity)) throw new Error(`Duplicate history for ${row.opportunity}`);
		finite(row.openedMs, ...(row.closedMs === undefined ? [] : [row.closedMs]));
		if ((row.closedMs === undefined) !== (row.status === undefined)) throw new Error("Close and status must be paired");
		if (row.closedMs !== undefined && row.closedMs < row.openedMs) throw new Error("Close precedes opening");
		found.set(row.opportunity, row);
	}
	return found;
}

export function readScenario(raw: unknown): Scenario {
	if (!Value.Check(scenarioSchema, raw))
		throw new Error(
			`Unreadable scenario: ${[...Value.Errors(scenarioSchema, raw)].map((error) => error.message).join("; ")}`,
		);
	const scenario = raw;
	finite(scenario.horizonMs, ...(scenario.decisionAt === "recording" ? [] : [scenario.decisionAt]));
	const ids = new Set<string>();
	const taskIds = new Set<string>();
	for (const opportunity of scenario.opportunities) {
		if (ids.has(opportunity.id)) throw new Error(`Duplicate opportunity ${opportunity.id}`);
		ids.add(opportunity.id);
		if (opportunity.taskId && taskIds.has(opportunity.taskId))
			throw new Error(`Duplicate task identity ${opportunity.taskId}`);
		if (opportunity.taskId) taskIds.add(opportunity.taskId);
		finite(opportunity.value, opportunity.costOfDelayPerHour);
	}
	const start = histories(scenario.start, ids);
	for (const row of start.values())
		if (row.openedMs > 0 || (row.closedMs !== undefined && row.closedMs > 0))
			throw new Error("Starting histories must be at or before the decision point");
	let probability = 0;
	for (const outcome of scenario.outcomes) {
		finite(outcome.probability);
		probability += outcome.probability;
		const tasks = histories(outcome.tasks, ids);
		for (const initial of start.values()) {
			const row = tasks.get(initial.opportunity);
			if (!row || row.openedMs !== initial.openedMs)
				throw new Error(`Initial obligation ${initial.opportunity} must retain its complete history`);
			if (initial.closedMs !== undefined && (row.closedMs !== initial.closedMs || row.status !== initial.status))
				throw new Error(`Already-closed obligation ${initial.opportunity} must remain unchanged`);
			if (initial.closedMs === undefined && row.closedMs !== undefined && row.closedMs < 0)
				throw new Error(`Initial open obligation ${initial.opportunity} cannot close before the decision point`);
		}
		for (const row of tasks.values())
			if (!start.has(row.opportunity) && row.openedMs < 0)
				throw new Error(`New opportunity ${row.opportunity} cannot open before the decision point`);
		for (const point of [...outcome.compute, ...outcome.impacts]) finite(point.atMs, point.dollars);
	}
	if (Math.abs(probability - 1) > Number.EPSILON * scenario.outcomes.length)
		throw new Error("Outcome probabilities must sum to 1");
	return scenario;
}

/** The scenario adapter emits the same point/interval representation as history; U owns all window arithmetic. */
function scenarioFitness(scenario: Scenario, recordingAt: number) {
	const decisionAt = scenario.decisionAt === "recording" ? recordingAt : scenario.decisionAt;
	boundEnd(decisionAt, scenario.horizonMs);
	const opportunities = new Map(scenario.opportunities.map((opportunity) => [opportunity.id, opportunity]));
	const outcomes = scenario.outcomes.map((outcome) => {
		const events: EconomicEvent[] = [];
		for (const task of outcome.tasks) {
			const opportunity = opportunities.get(task.opportunity)!;
			const source = `task:${opportunity.id}`;
			if (task.status === "done") events.push({ kind: "value", at: task.closedMs!, amount: opportunity.value, source });
			events.push({
				kind: "delay",
				from: task.openedMs,
				to: task.closedMs ?? scenario.horizonMs,
				perHour: opportunity.costOfDelayPerHour,
				source,
			});
		}
		for (const point of outcome.compute)
			events.push({ kind: "compute", at: point.atMs, amount: point.dollars, source: "scenario:compute" });
		for (const point of outcome.impacts)
			events.push({ kind: "impact", at: point.atMs, amount: point.dollars, source: "scenario:impact" });
		const evaluated = evaluate(events, 0, scenario.horizonMs);
		finite(evaluated.value, evaluated.delay, evaluated.compute, evaluated.impact, evaluated.total);
		return {
			probability: outcome.probability,
			total: evaluated.total,
			value: evaluated.value,
			delay: evaluated.delay,
			compute: evaluated.compute,
			impact: evaluated.impact,
			contributions: evaluated.contributions.map(({ source, value, delay, compute, impact }) => ({
				source,
				value,
				delay,
				compute,
				impact,
			})),
		};
	});
	const expected = outcomes.reduce((total, outcome) => total + outcome.probability * outcome.total, 0);
	finite(expected);
	return {
		name: scenario.name,
		organization: scenario.organization,
		decisionAt,
		horizonMs: scenario.horizonMs,
		expected,
		outcomes,
	};
}

const canonical = <T extends { id: string }>(rows: T[]) =>
	[...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
function premises(scenario: Scenario, recordingAt: number) {
	return {
		"decision point": scenario.decisionAt === "recording" ? recordingAt : scenario.decisionAt,
		horizon: scenario.horizonMs,
		opportunities: canonical(scenario.opportunities.map((o) => ({ id: o.id, taskId: o.taskId }))),
		valuations: canonical(
			scenario.opportunities.map((o) => ({ id: o.id, value: o.value, delay: o.costOfDelayPerHour })),
		),
		"starting work state": canonical(
			scenario.start.map((row) => ({
				id: row.opportunity,
				openedMs: row.openedMs,
				closedMs: row.closedMs,
				status: row.status,
			})),
		),
	};
}

export function compareScenarios(raw: unknown[], recordingAt: number) {
	if (!raw.length) throw new Error("Give at least one scenario");
	const scenarios = raw.map(readScenario);
	const first = premises(scenarios[0], recordingAt);
	for (const scenario of scenarios.slice(1)) {
		const next = premises(scenario, recordingAt);
		const differences = (Object.keys(first) as (keyof typeof first)[]).filter(
			(key) => JSON.stringify(first[key]) !== JSON.stringify(next[key]),
		);
		if (differences.length) throw new Error(`Scenarios differ in ${differences.join(", ")}`);
	}
	return {
		scenarios: scenarios.map((scenario) => scenarioFitness(scenario, recordingAt)),
		premise: "Supplied starting state and forecasts are manager premises, not a certified live snapshot",
	};
}

function valuationStatus(db: DatabaseSync, scenario: Scenario, organization: string, at: number) {
	const { owns } = taskOwnership(db, organization);
	let unverifiable = false;
	let changed = false;
	for (const opportunity of scenario.opportunities) {
		const task =
			opportunity.taskId && owns(opportunity.taskId, at)
				? (db.prepare("select bundle, opened_at from work_tasks where id = ?").get(opportunity.taskId) as
						| { bundle: string; opened_at: number | null }
						| undefined)
				: undefined;
		const path = task && task.opened_at !== null && task.opened_at <= at ? join(task.bundle, "task.md") : undefined;
		const current = path && existsSync(path) ? readValuation(readFileSync(path, "utf8")) : undefined;
		if (!current || current.value === null) unverifiable = true;
		else if (current.value !== opportunity.value || current.costOfDelayPerHour !== opportunity.costOfDelayPerHour)
			changed = true;
	}
	return changed ? "valuation changed" : unverifiable ? "valuation unverifiable" : undefined;
}

type ObservedFitness = ReturnType<typeof realizedFitness>;
type Coverage = ObservedFitness["coverage"];

export interface Prediction {
	link: string;
	target: string;
	recordedBy: string;
	recordedAt: number;
	raw: string | null;
	status: "unreadable" | "pending" | "observed";
	reason?: string;
	expected?: number;
	observed?: number | null;
	observation?: Pick<ObservedFitness, "incomplete" | "excludes" | "attention"> & {
		coverage: Omit<Coverage, "estimatedValueShare" | "unattributedValueShare"> & {
			estimatedValueShare: number | null;
			unattributedValueShare: number | null;
		};
		coverageReason?: string;
	};
	forecastError?: number | null;
	endsAt?: number;
}

/** Calibration reads unchanged link data; no predictions or binding table is persisted. */
export function predictions(db: DatabaseSync, organization: string, now: number): Prediction[] {
	const rows = db
		.prepare(
			"select * from links where relation = 'predicts' and to_kind = 'organization' and to_id = ? order by created_at, id",
		)
		.all(organization) as unknown as Link[];
	const belongs = linkOwnership(db, organization);
	return rows
		.filter((link) => belongs(link, link.created_at))
		.map((link) => {
			const base = {
				link: `link:${link.id}`,
				target: `organization:${link.to_id}`,
				recordedBy: `person:${link.recorded_by}`,
				recordedAt: link.created_at,
				raw: link.data,
			};
			let scenario: Scenario;
			let expected: ReturnType<typeof scenarioFitness>;
			let endsAt: number;
			try {
				if (link.from_kind !== "message") throw new Error("Prediction source must be a message stating the change");
				scenario = readScenario(JSON.parse(link.data ?? "null")?.scenario);
				expected = scenarioFitness(scenario, link.created_at);
				endsAt = boundEnd(link.created_at, scenario.horizonMs);
			} catch (error) {
				return { ...base, status: "unreadable", reason: (error as Error).message };
			}
			const reason =
				scenario.decisionAt !== "recording" && scenario.decisionAt !== link.created_at
					? "clock mismatch"
					: valuationStatus(db, scenario, link.to_id, link.created_at);
			if (now < endsAt)
				return { ...base, status: "pending", expected: expected.expected, endsAt, reason, forecastError: null };
			const observed = realizedFitness(db, link.to_id, link.created_at, endsAt);
			const reasons = reason ? [reason] : [];
			if (observed.incomplete) reasons.push("observed fitness incomplete");
			const { estimatedValueShare, unattributedValueShare } = observed.coverage;
			const sharesFinite = Number.isFinite(estimatedValueShare) && Number.isFinite(unattributedValueShare);
			const error = observed.total - expected.expected;
			if (!Number.isFinite(observed.total)) reasons.push("observed fitness non-finite");
			else if (!Number.isFinite(error)) reasons.push("forecast error non-finite");
			return {
				...base,
				status: "observed",
				expected: expected.expected,
				observed: Number.isFinite(observed.total) ? observed.total : null,
				observation: {
					coverage: {
						...observed.coverage,
						estimatedValueShare: Number.isFinite(estimatedValueShare) ? estimatedValueShare : null,
						unattributedValueShare: Number.isFinite(unattributedValueShare) ? unattributedValueShare : null,
					},
					incomplete: observed.incomplete,
					excludes: observed.excludes,
					attention: observed.attention,
					coverageReason: sharesFinite ? undefined : "coverage metadata non-finite",
				},
				endsAt,
				reason: reasons.join("; ") || undefined,
				forecastError: reasons.length ? null : error,
			};
		});
}
