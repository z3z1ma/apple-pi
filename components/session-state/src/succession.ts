import type { DatabaseSync } from "node:sqlite";
import { departureOf } from "./departures.js";
import { recordLink } from "./links.js";
import { temporaryCallers } from "./program-peers.js";
import { type Delivery, participateIn } from "./threads.js";
import { rootOf } from "./tree.js";

export function requireSuccessor(db: DatabaseSync, person: string, successor: unknown): void {
	if (successor === undefined) return;
	if (typeof successor !== "string" || successor === person) throw new Error("The successor must be another person.");
	const row = db.prepare("select retired_at from sessions where id = ? and kind = 'root'").get(successor) as
		| { retired_at: number | null }
		| undefined;
	if (!row || row.retired_at !== null || departureOf(db, successor) || temporaryCallers(db).has(successor))
		throw new Error("The successor must be a current lasting person.");
	if (rootOf(db, successor) !== rootOf(db, person))
		throw new Error("The successor must be in the departing person's organization.");
}

export function passOnAccess(db: DatabaseSync, id: string, person: string, successor: string, now: number): void {
	const rows = db
		.prepare(
			`select tp.thread_id, tp.delivery, tp.read_up_to, tp.invited, tp.following from thread_participants tp
			join threads t on t.id = tp.thread_id
			where tp.participant = ? and (t.kind != 'channel' or tp.invited = 1)`,
		)
		.all(person) as { thread_id: string; delivery: Delivery; read_up_to: number; invited: number; following: number }[];
	for (const row of rows) {
		if (
			db
				.prepare("select 1 from thread_participants where thread_id = ? and participant = ?")
				.get(row.thread_id, successor)
		)
			continue;
		participateIn(db, row.thread_id, successor, now, row.delivery, Boolean(row.following));
		db.prepare(
			"update thread_participants set read_up_to = ?, invited = ? where thread_id = ? and participant = ?",
		).run(row.read_up_to, row.invited, row.thread_id, successor);
	}
	recordLink(
		db,
		`${id}:successor`,
		person,
		{
			from: { kind: "person", id: successor },
			to: { kind: "person", id: person },
			relation: "supersedes",
			reason: "Successor named at permanent departure",
		},
		now,
	);
}
