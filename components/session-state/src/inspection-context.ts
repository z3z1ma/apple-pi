import type { DatabaseSync } from "node:sqlite";
import { membership, taskOwnership } from "./fitness.js";
import type { Scope, Window } from "./inspect.js";
import type { Assignment, WorkTask } from "./work.js";

export interface DetailPage {
	limit?: number;
	offset?: number;
}

export function pageRows<T>(rows: T[], page: DetailPage) {
	const offset = page.offset ?? 0;
	if (page.limit !== undefined && (!Number.isSafeInteger(page.limit) || page.limit < 1))
		throw new Error("Choose a positive integer limit");
	if (!Number.isSafeInteger(offset) || offset < 0 || (page.limit === undefined && page.offset !== undefined))
		throw new Error("Give a nonnegative offset with a limit");
	const selected = page.limit === undefined ? [] : rows.slice(offset, offset + page.limit);
	return {
		total: rows.length,
		offset,
		returned: selected.length,
		nextOffset: page.limit !== undefined && offset + selected.length < rows.length ? offset + selected.length : null,
		rows: selected,
	};
}

export interface Interval {
	from: number;
	to: number;
}

export function intervalUnion(intervals: Interval[]): number {
	let total = 0;
	let end = Number.NEGATIVE_INFINITY;
	for (const span of intervals.filter((span) => span.to > span.from).sort((a, b) => a.from - b.from)) {
		total += Math.max(0, span.to - Math.max(span.from, end));
		end = Math.max(end, span.to);
	}
	return total;
}

/** A query-local historical scope shared by work, execution and coordination projections. */
export function inspectionContext(db: DatabaseSync, organization: string, window: Window, scope: Scope = {}) {
	const to = window.to ?? Date.now();
	const from = window.from;
	if (!Number.isFinite(to) || (from !== undefined && (!Number.isFinite(from) || from >= to)))
		throw new Error("Choose a finite window whose start precedes its end");
	const history = membership(db, organization);
	const ownership = taskOwnership(db, organization);
	const tasks = db.prepare("select * from work_tasks where opened_at is not null").all() as unknown as WorkTask[];
	const assignments = db.prepare("select * from assignments order by assigned_at, id").all() as unknown as Assignment[];
	const byTask = new Map<string, Assignment[]>();
	for (const assignment of assignments) {
		const rows = byTask.get(assignment.task_id) ?? [];
		rows.push(assignment);
		byTask.set(assignment.task_id, rows);
	}
	const people = (person: string, at: number) => {
		const snapshot = history.replay(at);
		if (!snapshot.isMember(person)) return false;
		if (scope.person) return person === scope.person;
		if (!scope.subtree) return true;
		const seen = new Set<string>();
		for (let id: string | null = person; id && !seen.has(id); id = snapshot.managerOf(id)) {
			if (id === scope.subtree) return true;
			seen.add(id);
		}
		return false;
	};
	const held = (task: string, at: number, closing = false) =>
		(byTask.get(task) ?? []).filter(
			(row) =>
				row.assigned_at <= at && (row.ended_at === null || row.ended_at > at || (closing && row.ended_at === at)),
		);
	const visible = (task: string, at: number, closing = false) =>
		ownership.owns(task, at) &&
		(scope.task
			? scope.task === task
			: !scope.person && !scope.subtree
				? true
				: held(task, at, closing).some((assignment) => people(assignment.person, at)));
	const changes = (
		db
			.prepare(
				"select distinct at from events where type in ('reports_to_changed', 'transferred', 'retired', 'rehired', 'person_departed') order by at",
			)
			.all() as { at: number }[]
	).map((row) => row.at);
	const taskIntervals = (task: WorkTask): Interval[] => {
		if (from === undefined) return [];
		const start = Math.max(from, task.opened_at!);
		const end = Math.min(to, task.archived_at ?? to);
		if (end <= start) return [];
		const points = new Set([start, end, ...changes.filter((at) => at > start && at < end)]);
		for (const row of byTask.get(task.id) ?? [])
			for (const at of [row.assigned_at, row.ended_at]) if (at !== null && at > start && at < end) points.add(at);
		const cuts = [...points].sort((a, b) => a - b);
		return cuts.slice(0, -1).flatMap((at, i) => (visible(task.id, at) ? [{ from: at, to: cuts[i + 1] }] : []));
	};
	return {
		from,
		to,
		scope,
		history,
		ownership,
		tasks,
		assignments,
		byTask,
		people,
		held,
		visible,
		changes,
		taskIntervals,
	};
}

export type InspectionContext = ReturnType<typeof inspectionContext>;

/** Only committed focus transitions with their atomic task post establish historical focus. */
export function focusChanges(db: DatabaseSync, context: InspectionContext) {
	const rows = db
		.prepare(`select w.person, w.task_id, w.action, m.at, m.seq, m.id from work_changes w
		join thread_messages m on m.id = w.command_id || ':post' where m.at < ? order by m.at, m.seq`)
		.all(context.to) as {
		person: string;
		task_id: string;
		action: string;
		at: number;
		seq: number;
		id: string;
	}[];
	const focused = new Map<string, string>();
	const changes: { person: string; from: string | null; to: string | null; at: number; message: string }[] = [];
	for (const row of rows) {
		const before = focused.get(row.person);
		if (["take", "assign", "focus"].includes(row.action)) focused.set(row.person, row.task_id);
		else if (row.action === "finish" || (row.action === "unassign" && before === row.task_id))
			focused.delete(row.person);
		const after = focused.get(row.person);
		if (before === after || row.at < (context.from ?? context.to) || !context.people(row.person, row.at)) continue;
		if (context.scope.task && before !== context.scope.task && after !== context.scope.task) continue;
		changes.push({
			person: `person:${row.person}`,
			from: before ? `task:${before}` : null,
			to: after ? `task:${after}` : null,
			at: row.at,
			message: `message:${row.id}`,
		});
	}
	return changes;
}
