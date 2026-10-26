import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { WAITS } from "./links.js";
import { readValuation } from "./valuation.js";

const HOUR = 3_600_000;

/** One fact the evaluator adds up; `source` names what produced it, such as `task:<id>` or `person:<id>`. */
export type EconomicEvent =
	| { kind: "value" | "compute" | "impact"; at: number; amount: number; source: string }
	| { kind: "delay"; from: number; to: number; perHour: number; source: string; state?: DelayState };

/** Why work waited: nobody had it and nothing blocked it, an open wait blocked it, or someone was working on it. */
export type DelayState = "queued" | "waiting" | "inProgress";
const noDelay = (): Record<DelayState, number> => ({ queued: 0, waiting: 0, inProgress: 0 });

export interface Contribution {
	source: string;
	value: number;
	delay: number;
	delayByState: Record<DelayState, number>;
	compute: number;
	impact: number;
}

/** The wait relations as an SQL list; `links.ts` owns which relations are waits. */
const WAIT_LIST = WAITS.map((relation) => `'${relation}'`).join(", ");

/**
 * The pure evaluator U: sums what falls in `[from, to)`. Every event is a point or an interval charged by its overlap,
 * so any split of a window adds up to the whole.
 */
export function evaluate(events: EconomicEvent[], from: number, to: number) {
	const parts = new Map<string, Contribution>();
	const part = (source: string) => {
		const found = parts.get(source) ?? { source, value: 0, delay: 0, delayByState: noDelay(), compute: 0, impact: 0 };
		parts.set(source, found);
		return found;
	};
	for (const event of events) {
		if (event.kind === "delay") {
			const hours = Math.max(0, Math.min(event.to, to) - Math.max(event.from, from)) / HOUR;
			if (hours > 0) {
				const charged = part(event.source);
				charged.delay += hours * event.perHour;
				if (event.state) charged.delayByState[event.state] += hours * event.perHour;
			}
		} else if (event.at >= from && event.at < to) part(event.source)[event.kind] += event.amount;
	}
	const contributions = [...parts.values()];
	const sum = (key: "value" | "delay" | "compute" | "impact") => contributions.reduce((t, c) => t + c[key], 0);
	const value = sum("value");
	const delay = sum("delay");
	const compute = sum("compute");
	const impact = sum("impact");
	const delayByState = noDelay();
	for (const c of contributions)
		for (const state of Object.keys(delayByState) as DelayState[]) delayByState[state] += c.delayByState[state];
	return { total: value - delay - compute + impact, value, delay, delayByState, compute, impact, contributions };
}

interface TaskRow {
	id: string;
	bundle: string;
	opened_at: number | null;
	archived_at: number | null;
	close_status: string | null;
}

/** The history adapter: an organization's recorded tasks as economic events, valued by their current task.md. */
function historyEvents(db: DatabaseSync, organization: string, from: number, until: number) {
	// A task only temporary pi_exec peers hold is a step inside their caller's work, the same set their disposal deletes.
	const ownership = taskOwnership(db, organization);
	const tasks = db
		.prepare(
			`select id, bundle, opened_at, archived_at, close_status from work_tasks t
			where opened_at is not null and not (
				ephemeral = 1
				and exists (select 1 from assignments a where a.task_id = t.id)
				and not exists (
					select 1 from assignments a where a.task_id = t.id
					and a.person not in (select session_id from program_peers)
				)
			)`,
		)
		.all() as unknown as TaskRow[];
	const events: EconomicEvent[] = [];
	const relevant = tasks.flatMap((task) => {
		const closed = task.archived_at ?? until;
		const owned = ownership.intervals(task.id, Math.max(from, task.opened_at!), Math.min(until, closed));
		const ownedAtClose =
			task.archived_at !== null &&
			task.archived_at >= from &&
			task.archived_at < until &&
			ownership.owns(task.id, task.archived_at);
		return owned.length || ownedAtClose ? [{ task, owned, ownedAtClose }] : [];
	});
	const valued = relevant.map(({ task, owned, ownedAtClose }) => {
		// A goal file that has gone counts as unvalued, which marks the result incomplete.
		const goal = join(task.bundle, "task.md");
		const valuation = readValuation(existsSync(goal) ? readFileSync(goal, "utf8") : "");
		const source = `task:${task.id}`;
		if (valuation.value !== null) {
			if (task.close_status === "done" && task.archived_at !== null && ownedAtClose)
				events.push({ kind: "value", at: task.archived_at, amount: valuation.value, source });
			if (valuation.costOfDelayPerHour > 0)
				for (const interval of owned)
					for (const span of delayStates(db, task.id, interval.from, interval.to))
						events.push({ kind: "delay", ...span, perHour: valuation.costOfDelayPerHour, source });
		}
		return { task, valuation };
	});
	events.push(...computeEvents(db, organization));
	return { events, valued, eligibleTasks: new Set(tasks.map((task) => task.id)) };
}

/** A task's delay interval cut where its state changed: an assignment began or ended, or a wait on it opened or closed. */
function delayStates(db: DatabaseSync, task: string, from: number, to: number) {
	const held = db
		.prepare("select assigned_at as start, ended_at as stop from assignments where task_id = ?")
		.all(task) as { start: number; stop: number | null }[];
	const waits = db
		.prepare(
			`select created_at as start, resolved_at as stop from links where from_kind = 'task' and from_id = ? and relation in (${WAIT_LIST})`,
		)
		.all(task) as { start: number; stop: number | null }[];
	const during = (spans: { start: number; stop: number | null }[], at: number) =>
		spans.some((span) => span.start <= at && (span.stop === null || at < span.stop));
	const cuts = [...new Set([from, to, ...[...held, ...waits].flatMap((s) => [s.start, s.stop ?? to])])]
		.filter((at) => at >= from && at <= to)
		.sort((a, b) => a - b);
	const spans: { from: number; to: number; state: DelayState }[] = [];
	for (let i = 0; i + 1 < cuts.length; i++) {
		const at = cuts[i];
		const state: DelayState = during(waits, at) ? "waiting" : during(held, at) ? "inProgress" : "queued";
		spans.push({ from: at, to: cuts[i + 1], state });
	}
	return spans;
}

interface Recorded {
	session_id: string;
	at: number;
	type: string;
	data: string | null;
}

/**
 * Who belonged to the organization, replayed from the runtime's events in the order it recorded them (`seq`): a hello
 * seeding a manager (`reports_to_changed`), a move (`transferred`), a departure (`retired`), and a rehire
 * (`rehired`). A person is a member while its manager chain reaches the organization and it has not been let go; a
 * temporary pi_exec peer never is, because disposal deletes it. Before its first recorded change a person had the manager
 * that change replaced, and a person with none has its current manager throughout. So a later join or move, even in the
 * same millisecond, never rewrites who belonged earlier.
 */
export function membership(db: DatabaseSync, organization: string) {
	const peers = new Set(
		(db.prepare("select session_id from program_peers").all() as { session_id: string }[]).map((r) => r.session_id),
	);
	const stream = db
		.prepare(
			"select session_id, at, type, data from events where type in ('reports_to_changed', 'transferred', 'retired', 'rehired', 'cost_changed', 'prompt_opened') order by seq",
		)
		.all() as unknown as Recorded[];
	const seeds = new Map(
		(db.prepare("select id, reports_to from sessions").all() as { id: string; reports_to: string | null }[]).map(
			(row) => [row.id, row.reports_to],
		),
	);
	const seeded = new Set<string>();
	for (const row of stream)
		if ((row.type === "reports_to_changed" || row.type === "transferred") && !seeded.has(row.session_id)) {
			seeded.add(row.session_id);
			seeds.set(row.session_id, JSON.parse(row.data ?? "{}").from ?? null);
		}
	const structural = stream.filter((row) => row.type !== "cost_changed" && row.type !== "prompt_opened");
	/** Replays every event recorded at or before `until`, calling `visit` after each with membership at that point. */
	const replay = (
		until: number,
		visit?: (row: Recorded, data: Record<string, unknown>, isMember: (person: string) => boolean) => void,
	) => {
		const manager = new Map(seeds);
		const departed = new Set<string>();
		const isMember = (person: string) => {
			if (peers.has(person) || departed.has(person)) return false;
			const seen = new Set<string>();
			for (let link: string | null | undefined = person; link && !seen.has(link); link = manager.get(link)) {
				if (link === organization) return true;
				seen.add(link);
			}
			return false;
		};
		for (const row of visit ? stream : structural) {
			if (row.at > until) continue;
			const data = JSON.parse(row.data ?? "{}");
			if (row.type === "reports_to_changed" || row.type === "transferred") manager.set(row.session_id, data.to ?? null);
			else if (row.type === "retired") departed.add(row.session_id);
			else if (row.type === "rehired") departed.delete(row.session_id);
			visit?.(row, data, isMember);
		}
		return { isMember, managerOf: (person: string) => manager.get(person) ?? null };
	};
	return {
		replay,
		memberAt: (person: string, at: number) => replay(at).isMember(person),
		/** The manager a person had at a moment, as recorded. */
		managerAt: (person: string, at: number) => replay(at).managerOf(person),
	};
}

/** Task ownership follows structural ancestry; retiring a person does not discard its organization's obligations. */
export function taskOwnership(db: DatabaseSync, organization: string) {
	const { managerAt } = membership(db, organization);
	const anchors = new Map(
		(db.prepare("select id, organization from work_tasks").all() as { id: string; organization: string }[]).map(
			(row) => [row.id, row.organization],
		),
	);
	const changes = (
		db
			.prepare("select distinct at from events where type in ('reports_to_changed', 'transferred') order by at")
			.all() as { at: number }[]
	).map((row) => row.at);
	const owns = (task: string, at: number) => {
		const seen = new Set<string>();
		for (
			let anchor: string | null | undefined = anchors.get(task);
			anchor && !seen.has(anchor);
			anchor = managerAt(anchor, at)
		) {
			if (anchor === organization) return true;
			seen.add(anchor);
		}
		return false;
	};
	return {
		owns,
		intervals: (task: string, from: number, to: number) => {
			const cuts = [from, ...changes.filter((at) => at > from && at < to), to];
			return cuts
				.slice(0, -1)
				.flatMap((at, i) => (at < cuts[i + 1] && owns(task, at) ? [{ from: at, to: cuts[i + 1] }] : []));
		},
	};
}

/**
 * Each member's spend at the moment it was recorded. A cost change marked `hello` is spend the transcript already held
 * before any cost was recorded for the session: a baseline.
 */
function computeEvents(db: DatabaseSync, organization: string): EconomicEvent[] {
	const events: EconomicEvent[] = [];
	membership(db, organization).replay(Number.POSITIVE_INFINITY, (row, data, isMember) => {
		if (row.type !== "cost_changed" || data.hello || !isMember(row.session_id)) return;
		const amount = (data.to as number) - (data.from as number);
		if (amount > 0) events.push({ kind: "compute", at: row.at, amount, source: `person:${row.session_id}` });
	});
	return events;
}

/** Waits still open at the window's end, from the organization's tasks or recorded by a member at that time. */
export function openWaits(db: DatabaseSync, organization: string, at: number, eligibleTasks?: ReadonlySet<string>) {
	const { memberAt } = membership(db, organization);
	const { owns } = taskOwnership(db, organization);
	return (
		db
			.prepare(
				`select id, from_kind, from_id, to_kind, to_id, relation, reason, recorded_by, created_at from links
				where relation in (${WAIT_LIST}) and created_at < ? and (resolved_at is null or resolved_at > ?) order by created_at, id`,
			)
			.all(at, at) as {
			id: string;
			from_kind: string;
			from_id: string;
			to_kind: string;
			to_id: string;
			relation: string;
			reason: string | null;
			recorded_by: string;
			created_at: number;
		}[]
	)
		.filter(
			(link) =>
				(link.from_kind === "task" && (!eligibleTasks || eligibleTasks.has(link.from_id)) && owns(link.from_id, at)) ||
				memberAt(link.recorded_by, at),
		)
		.map((link) => ({ ...link, ageHours: (at - link.created_at) / HOUR }));
}

/**
 * Demands on the operator: questions opened, and messages sent in mail threads the operator is in, by people who were
 * members when they did it.
 */
function interruptions(db: DatabaseSync, organization: string, from: number, to: number): number {
	const { replay, memberAt } = membership(db, organization);
	let questions = 0;
	replay(to, (row, _data, isMember) => {
		if (row.type === "prompt_opened" && row.at >= from && row.at < to && isMember(row.session_id)) questions++;
	});
	const mail = (
		db
			.prepare(
				`select m.sender, m.at from thread_messages m join threads t on t.id = m.thread_id
				where t.kind in ('mail', 'escalation') and m.at >= ? and m.at < ?
				and exists (
					select 1 from thread_participants p where p.thread_id = t.id and p.participant = 'operator' and p.joined_at <= m.at
				)`,
			)
			.all(from, to) as { sender: string; at: number }[]
	).filter((row) => memberAt(row.sender, row.at)).length;
	return questions + mail;
}

/** Everyone at or below `person` in the reporting tree. */
export function subtreeOf(db: DatabaseSync, person: string): Set<string> {
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
	const { events, valued: inWindow, eligibleTasks } = historyEvents(db, organization, from, to);
	const result = evaluate(events, from, to);
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
		openWaits: openWaits(db, organization, to, eligibleTasks),
		interruptions: interruptions(db, organization, from, to),
		// The operator's time is part of the model, but nothing measures it honestly yet; waiting for him is already delay.
		attention: { pricePerMinute: 1, measured: false },
		// Disposal deletes a temporary peer, so what it spent and asked cannot be charged to its caller afterwards.
		excludes: "the spend, questions, and operator mail of temporary pi_exec peers",
	};
}
