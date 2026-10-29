import type { DatabaseSync } from "node:sqlite";
import { departedPeople } from "./departures.js";
import { temporaryCallers } from "./program-peers.js";
import { nameOf, participateIn } from "./threads.js";

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
	const members = db.prepare("select participant, invited from thread_participants where thread_id = ?");
	const retired = new Set([
		...people.filter((person) => person.retired_at !== null).map((person) => person.id),
		...departedPeople(db).keys(),
	]);
	const reconcile = (channel: string, team: Set<string>, excluded: Set<string>) => {
		for (const member of members.all(channel) as { participant: string; invited: number }[]) {
			if (excluded.has(member.participant) || (!member.invited && !team.has(member.participant)))
				participateIn(db, channel, member.participant, now, null);
		}
		for (const id of team) participateIn(db, channel, id, now, "pull");
	};
	for (const manager of managers) {
		const channel = `team:${manager.id}`;
		thread.run(channel, `${nameOf(db, manager.id)}'s team`, manager.id, now);
		const team = new Set(
			people
				.filter((person) => !retired.has(person.id) && (person.id === manager.id || person.reports_to === manager.id))
				.map((person) => person.id),
		);
		reconcile(channel, team, retired);
	}

	const excluded = new Set([...retired, ...temporaryCallers(db).keys()]);
	const ids = new Set(people.map((person) => person.id));
	const heads = new Set(
		people
			.filter((person) => !excluded.has(person.id) && (person.reports_to === null || !ids.has(person.reports_to)))
			.map((person) => person.id),
	);
	for (const channel of existing)
		if (channel.startsWith("organization:")) heads.add(channel.slice("organization:".length));
	for (const head of heads) {
		const channel = `organization:${head}`;
		thread.run(channel, `${nameOf(db, head)}'s organization`, head, now);
		const branch = new Set(ids.has(head) && !excluded.has(head) ? [head] : []);
		for (let size = -1; size !== branch.size; ) {
			size = branch.size;
			for (const person of people)
				if (person.reports_to !== null && branch.has(person.reports_to)) branch.add(person.id);
		}
		reconcile(channel, new Set([...branch].filter((id) => !excluded.has(id))), excluded);
	}
}
