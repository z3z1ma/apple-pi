import type { DatabaseSync } from "node:sqlite";
import { nameOf } from "./threads.js";

/** Reconcile team channels from the tree. Invited people stay when their reporting line changes. */
export function syncChannels(db: DatabaseSync, now: number): void {
	const people = db.prepare("select id, reports_to, manages, retired_at from sessions where kind = 'root'").all() as {
		id: string;
		reports_to: string | null;
		manages: number | null;
		retired_at: number | null;
	}[];
	const existing = new Set(
		(db.prepare("select id from threads where kind = 'channel'").all() as { id: string }[]).map((row) => row.id),
	);
	const managers = people.filter(
		(person) =>
			person.reports_to === null ||
			person.manages === 1 ||
			people.some((p) => p.reports_to === person.id) ||
			existing.has(`team:${person.id}`),
	);
	const thread =
		db.prepare(`insert into threads (id, kind, subject, created_by, created_at) values (?, 'channel', ?, ?, ?)
		on conflict (id) do update set subject = excluded.subject`);
	const join = db.prepare(`insert into thread_participants (thread_id, participant, delivery, read_up_to, joined_at)
		values (?, ?, 'pull', 0, ?) on conflict (thread_id, participant) do nothing`);
	const members = db.prepare("select participant, invited from thread_participants where thread_id = ?");
	const leave = db.prepare("delete from thread_participants where thread_id = ? and participant = ?");
	const retired = new Set(people.filter((person) => person.retired_at !== null).map((person) => person.id));
	for (const manager of managers) {
		const channel = `team:${manager.id}`;
		thread.run(channel, `${nameOf(db, manager.id)}'s team`, manager.id, now);
		const team = new Set(
			people
				.filter((person) => !retired.has(person.id) && (person.id === manager.id || person.reports_to === manager.id))
				.map((person) => person.id),
		);
		for (const member of members.all(channel) as { participant: string; invited: number }[]) {
			if (retired.has(member.participant) || (!member.invited && !team.has(member.participant)))
				leave.run(channel, member.participant);
		}
		for (const id of team) join.run(channel, id, now);
	}
}
