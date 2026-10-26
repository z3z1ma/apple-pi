import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { readValuation } from "./valuation.js";

const HOUR = 3_600_000;

/** One fact the evaluator adds up; `source` names what produced it, such as `task:<id>` or `person:<id>`. */
export type EconomicEvent =
	| { kind: "value" | "compute" | "impact"; at: number; amount: number; source: string }
	| { kind: "delay"; from: number; to: number; perHour: number; source: string };

export interface Contribution {
	source: string;
	value: number;
	delay: number;
	compute: number;
	impact: number;
}

/**
 * The pure evaluator U: sums what falls in `[from, to)`. Every event is a point or an interval charged by its overlap,
 * so any split of a window adds up to the whole.
 */
export function evaluate(events: EconomicEvent[], from: number, to: number) {
	const parts = new Map<string, Contribution>();
	const part = (source: string) => {
		const found = parts.get(source) ?? { source, value: 0, delay: 0, compute: 0, impact: 0 };
		parts.set(source, found);
		return found;
	};
	for (const event of events) {
		if (event.kind === "delay") {
			const hours = Math.max(0, Math.min(event.to, to) - Math.max(event.from, from)) / HOUR;
			if (hours > 0) part(event.source).delay += hours * event.perHour;
		} else if (event.at >= from && event.at < to) part(event.source)[event.kind] += event.amount;
	}
	const contributions = [...parts.values()];
	const sum = (key: "value" | "delay" | "compute" | "impact") => contributions.reduce((t, c) => t + c[key], 0);
	const value = sum("value");
	const delay = sum("delay");
	const compute = sum("compute");
	const impact = sum("impact");
	return { total: value - delay - compute + impact, value, delay, compute, impact, contributions };
}

interface TaskRow {
	id: string;
	bundle: string;
	opened_at: number | null;
	archived_at: number | null;
	close_status: string | null;
}

/** The history adapter: an organization's recorded tasks as economic events, valued by their current task.md. */
function historyEvents(db: DatabaseSync, organization: string, until: number) {
	// A task only temporary pi_exec peers hold is a step inside their caller's work, the same set their disposal deletes.
	const tasks = db
		.prepare(
			`select id, bundle, opened_at, archived_at, close_status from work_tasks t
			where organization = ? and opened_at is not null and not (
				ephemeral = 1
				and exists (select 1 from assignments a where a.task_id = t.id)
				and not exists (
					select 1 from assignments a where a.task_id = t.id
					and a.person not in (select session_id from program_peers)
				)
			)`,
		)
		.all(organization) as unknown as TaskRow[];
	const events: EconomicEvent[] = [];
	const valued = tasks.map((task) => {
		// A goal file that has gone counts as unvalued, which marks the result incomplete.
		const goal = join(task.bundle, "task.md");
		const valuation = readValuation(existsSync(goal) ? readFileSync(goal, "utf8") : "");
		const source = `task:${task.id}`;
		const closed = task.archived_at ?? until;
		if (valuation.value !== null) {
			if (task.close_status === "done" && task.archived_at !== null)
				events.push({ kind: "value", at: task.archived_at, amount: valuation.value, source });
			if (valuation.costOfDelayPerHour > 0)
				events.push({
					kind: "delay",
					from: task.opened_at!,
					to: closed,
					perHour: valuation.costOfDelayPerHour,
					source,
				});
		}
		return { task, valuation, closed };
	});
	events.push(...computeEvents(db, organization));
	return { events, valued };
}

/**
 * Each member's spend, counted when the spender's manager chain reached the organization at that moment and the spender
 * had not been let go. The runtime's events are replayed in the order it recorded them (`seq`): a hello seeding a manager
 * (`reports_to_changed`), a move (`transferred`), a departure (`retired`), a rehire (`rehired`), and spend
 * (`cost_changed`), so a later join or move, even in the same millisecond, never rewrites earlier spend. A cost change
 * marked `hello` is spend the transcript already held before any cost was recorded for the session: a baseline. A temporary
 * pi_exec peer's spend is left out with its tasks, because disposal deletes the peer.
 */
function computeEvents(db: DatabaseSync, organization: string): EconomicEvent[] {
	const peers = new Set(
		(db.prepare("select session_id from program_peers").all() as { session_id: string }[]).map((r) => r.session_id),
	);
	const stream = db
		.prepare(
			"select session_id, at, type, data from events where type in ('reports_to_changed', 'transferred', 'retired', 'rehired', 'cost_changed') order by seq",
		)
		.all() as { session_id: string; at: number; type: string; data: string | null }[];
	// Before its first recorded change a person had the manager that change replaced; with none, its current one.
	const manager = new Map(
		(db.prepare("select id, reports_to from sessions").all() as { id: string; reports_to: string | null }[]).map(
			(row) => [row.id, row.reports_to],
		),
	);
	const seeded = new Set<string>();
	for (const row of stream)
		if ((row.type === "reports_to_changed" || row.type === "transferred") && !seeded.has(row.session_id)) {
			seeded.add(row.session_id);
			manager.set(row.session_id, JSON.parse(row.data ?? "{}").from ?? null);
		}
	const inOrganization = (person: string) => {
		const seen = new Set<string>();
		for (let link: string | null | undefined = person; link && !seen.has(link); link = manager.get(link)) {
			if (link === organization) return true;
			seen.add(link);
		}
		return false;
	};
	const departed = new Set<string>();
	const events: EconomicEvent[] = [];
	for (const row of stream) {
		const data = JSON.parse(row.data ?? "{}");
		if (row.type === "reports_to_changed" || row.type === "transferred") manager.set(row.session_id, data.to ?? null);
		else if (row.type === "retired") departed.add(row.session_id);
		else if (row.type === "rehired") departed.delete(row.session_id);
		else if (
			!peers.has(row.session_id) &&
			!departed.has(row.session_id) &&
			!data.hello &&
			data.to > data.from &&
			inOrganization(row.session_id)
		)
			events.push({ kind: "compute", at: row.at, amount: data.to - data.from, source: `person:${row.session_id}` });
	}
	return events;
}

/** Everyone at or below `person` in the reporting tree. */
function subtreeOf(db: DatabaseSync, person: string): Set<string> {
	const members = new Set([person]);
	for (let grew = true; grew; ) {
		grew = false;
		for (const row of db.prepare("select id, reports_to from sessions where reports_to is not null").all() as {
			id: string;
			reports_to: string;
		}[])
			if (members.has(row.reports_to) && !members.has(row.id)) {
				members.add(row.id);
				grew = true;
			}
	}
	return members;
}

/** Realized fitness of one organization over `[from, to)`, recomputed from recorded facts and current valuations. */
export function realizedFitness(
	db: DatabaseSync,
	organization: string,
	from: number,
	to: number,
	options: { subtree?: string } = {},
) {
	const { events, valued } = historyEvents(db, organization, to);
	const result = evaluate(events, from, to);
	const inWindow = valued.filter(({ task, closed }) => task.opened_at! < to && closed >= from);
	const unvaluedTasks = inWindow.filter(({ valuation }) => valuation.value === null);
	const unvalued = unvaluedTasks.length;
	const closedUnvalued = unvaluedTasks.filter(({ task }) => task.archived_at !== null && task.archived_at < to).length;
	const totalValue = inWindow.reduce((sum, { valuation }) => sum + (valuation.value ?? 0), 0);
	const estimatedValue = inWindow.reduce(
		(sum, { valuation }) => sum + (valuation.estimatedBy === null ? 0 : (valuation.value ?? 0)),
		0,
	);
	let contributions = result.contributions;
	if (options.subtree) {
		const people = subtreeOf(db, options.subtree);
		const held = new Set(
			(db.prepare("select distinct task_id, person from assignments").all() as { task_id: string; person: string }[])
				.filter((row) => people.has(row.person))
				.map((row) => `task:${row.task_id}`),
		);
		for (const person of people) held.add(`person:${person}`);
		contributions = contributions.filter((c) => held.has(c.source));
	}
	return {
		...result,
		contributions,
		perHour: result.total / ((to - from) / HOUR),
		coverage: {
			tasks: inWindow.length,
			unvalued,
			unvaluedShare: inWindow.length ? unvalued / inWindow.length : 0,
			outstandingUnvalued: unvalued - closedUnvalued,
			closedUnvalued,
			estimatedValueShare: totalValue ? estimatedValue / totalValue : 0,
			unattributedValueShare: totalValue ? 1 - estimatedValue / totalValue : 0,
		},
		incomplete: unvalued > 0,
		// Disposal deletes a temporary peer, so its spend cannot be charged to its caller afterwards.
		computeExcludes: "spend of temporary pi_exec peers",
	};
}
