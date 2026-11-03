
import type { DatabaseSync } from "node:sqlite";

export interface Schedule {
	id: string;
	owner: string;
	target: string;
	body: string;
	next_at: number;
	every_ms: number | null;
	created_at: number;
	cancelled_at: number | null;
	last_fired_at: number | null;
}

export function createSchedule(
	db: DatabaseSync,
	id: string,
	owner: string,
	command: { to: string; body: string; firstAt: number; everyMs?: number },
	now: number,
): void {
	if (!command.body.trim()) throw new Error("A schedule needs a message.");
	if (!Number.isFinite(command.firstAt)) throw new Error("A schedule needs a first time.");
	if (command.everyMs !== undefined && !(command.everyMs >= 60_000))
		throw new Error("A repeating schedule repeats at most once a minute.");
	if (!db.prepare("select 1 from sessions where id = ? and kind = 'root' and retired_at is null").get(command.to))
		throw new Error(`No current person ${command.to}.`);
	db.prepare(
		`insert into schedules (id, owner, target, body, next_at, every_ms, created_at) values (?, ?, ?, ?, ?, ?, ?)
		on conflict (id) do nothing`,
	).run(id, owner, command.to, command.body, Math.max(command.firstAt, now), command.everyMs ?? null, now);
}

export function cancelSchedule(db: DatabaseSync, id: string, actor: string, operator: string, now: number): void {
	const row = db.prepare("select owner, target, cancelled_at from schedules where id = ?").get(id) as
		| Pick<Schedule, "owner" | "target" | "cancelled_at">
		| undefined;
	if (!row) throw new Error(`No schedule ${id}.`);
	if (actor !== operator && actor !== row.owner && actor !== row.target)
		throw new Error("Only the schedule's owner, its recipient or the operator can cancel it.");
	if (row.cancelled_at === null) db.prepare("update schedules set cancelled_at = ? where id = ?").run(now, id);
}

export function activeSchedules(db: DatabaseSync, person?: string): Schedule[] {
	return (person
		? db
				.prepare("select * from schedules where cancelled_at is null and (owner = ? or target = ?) order by next_at")
				.all(person, person)
		: db.prepare("select * from schedules where cancelled_at is null order by next_at").all()) as unknown as Schedule[];
}

export function dueSchedules(db: DatabaseSync, now: number): Schedule[] {
	return db
		.prepare("select * from schedules where cancelled_at is null and next_at <= ? order by next_at")
		.all(now) as unknown as Schedule[];
}

export function nextScheduleAt(db: DatabaseSync): number | undefined {
	const row = db.prepare("select min(next_at) as at from schedules where cancelled_at is null").get() as {
		at: number | null;
	};
	return row.at ?? undefined;
}

export function markFired(db: DatabaseSync, schedule: Schedule, now: number): void {
	if (schedule.every_ms === null) {
		db.prepare("update schedules set cancelled_at = ?, last_fired_at = ? where id = ?").run(now, now, schedule.id);
		return;
	}
	const missed = Math.floor((now - schedule.next_at) / schedule.every_ms) + 1;
	db.prepare("update schedules set next_at = ?, last_fired_at = ? where id = ?").run(
		schedule.next_at + missed * schedule.every_ms,
		now,
		schedule.id,
	);
}
