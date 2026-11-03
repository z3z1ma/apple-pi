import type { DatabaseSync } from "node:sqlite";
import { OPERATOR } from "./threads.js";

export interface FocusSpan {
	person: string;
	task: string;
	from: number;
	to: number | null;
	reconstructed: boolean;
}

export function reconstructSpans(db: DatabaseSync, now: number): void {
	if (db.prepare("select 1 from focus_spans limit 1").get()) return;
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
}

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

export function mayReadEntry(db: DatabaseSync, caller: string, session: string, at: number | undefined): boolean {
	if (caller === OPERATOR || caller === session) return true;
	if (at === undefined) return false;
	const covering = db
		.prepare(
			"select distinct task_id from focus_spans where person = ? and started_at <= ? and (ended_at is null or ended_at >= ?)",
		)
		.all(session, at, at) as { task_id: string }[];
	return covering.some((row) => maySearchTask(db, caller, row.task_id));
}

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
