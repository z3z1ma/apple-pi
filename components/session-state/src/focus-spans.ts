// Task spans: the stretches of each person's transcript written while they were focused on a task. Triggers on
// `work_focus` record spans as focus changes (schema.ts); this module replays the earlier history once, and answers who
// may search a task's spans and which spans a task has.
import type { DatabaseSync } from "node:sqlite";
import { OPERATOR } from "./threads.js";

export interface FocusSpan {
	person: string;
	task: string;
	from: number;
	/** Null while the person is still focused on the task. */
	to: number | null;
	reconstructed: boolean;
}

/**
 * Spans for the focus history before spans were recorded, replayed from retained work changes and their task posts.
 * Runs once, while the table is empty. A gap in that history is a gap in spans, not a guess.
 */
export function reconstructSpans(db: DatabaseSync, now: number): number {
	if (db.prepare("select 1 from focus_spans limit 1").get()) return 0;
	const rows = db
		.prepare(`select w.person, w.task_id, w.action, m.at from work_changes w
			join thread_messages m on m.id = w.command_id || ':post' order by m.at, m.seq`)
		.all() as { person: string; task_id: string; action: string; at: number }[];
	const open = new Map<string, { task: string; from: number }>();
	const spans: Omit<FocusSpan, "reconstructed">[] = [];
	const end = (person: string, at: number) => {
		const span = open.get(person);
		if (span) spans.push({ person, task: span.task, from: span.from, to: at });
		open.delete(person);
	};
	for (const row of rows) {
		if (["take", "assign", "focus"].includes(row.action)) {
			if (open.get(row.person)?.task === row.task_id) continue;
			end(row.person, row.at);
			open.set(row.person, { task: row.task_id, from: row.at });
		} else if (row.action === "finish") end(row.person, row.at);
		else if (row.action === "unassign" && open.get(row.person)?.task === row.task_id) end(row.person, row.at);
		else if (row.action === "close")
			for (const [person, span] of open) if (span.task === row.task_id) end(person, row.at);
	}
	// What is still open must agree with today's focus; anything else ended at an unrecorded time before now.
	const current = new Map(
		(db.prepare("select person, task_id from work_focus").all() as { person: string; task_id: string }[]).map((row) => [
			row.person,
			row.task_id,
		]),
	);
	for (const [person, span] of open)
		spans.push({ person, task: span.task, from: span.from, to: current.get(person) === span.task ? null : now });
	for (const [person, task] of current)
		if (open.get(person)?.task !== task) spans.push({ person, task, from: now, to: null });
	const insert = db.prepare(
		"insert into focus_spans (person, task_id, started_at, ended_at, reconstructed) values (?, ?, ?, ?, 1)",
	);
	for (const span of spans) insert.run(span.person, span.task, span.from, span.to);
	return spans.length;
}

/** The spans of these tasks, oldest first. */
export function taskSpans(db: DatabaseSync, tasks: string[]): FocusSpan[] {
	if (!tasks.length) return [];
	return (
		db
			.prepare(
				`select person, task_id, started_at, ended_at, reconstructed from focus_spans
				where task_id in (${tasks.map(() => "?").join(", ")}) order by started_at`,
			)
			.all(...tasks) as {
			person: string;
			task_id: string;
			started_at: number;
			ended_at: number | null;
			reconstructed: number;
		}[]
	).map((row) => ({
		person: row.person,
		task: row.task_id,
		from: row.started_at,
		to: row.ended_at,
		reconstructed: row.reconstructed === 1,
	}));
}

/**
 * Whether `caller` may search a task's spans: the operator; anyone ever assigned to the task; and anyone above, in
 * today's reporting tree, a person who worked on it (operator decision, 2026-11-02).
 */
export function maySearchTask(db: DatabaseSync, caller: string, task: string): boolean {
	if (caller === OPERATOR) return true;
	const workers = (
		db
			.prepare(
				"select person from assignments where task_id = ? union select person from focus_spans where task_id = ?",
			)
			.all(task, task) as { person: string }[]
	).map((row) => row.person);
	if (workers.includes(caller)) return true;
	const managerOf = db.prepare("select reports_to from sessions where id = ?");
	for (const worker of workers) {
		const seen = new Set<string>([worker]);
		let person: string | null | undefined = worker;
		while (person) {
			person = (managerOf.get(person) as { reports_to: string | null } | undefined)?.reports_to;
			if (!person || seen.has(person)) break;
			if (person === caller) return true;
			seen.add(person);
		}
	}
	return false;
}
