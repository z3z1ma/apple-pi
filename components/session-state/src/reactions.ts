/**
 * Reactions on thread messages: a lightweight acknowledgment (seen, done, agreed) that is recorded and shown with the
 * message, and wakes nobody. Readers see them in the message's `reactions`.
 */

import type { DatabaseSync } from "node:sqlite";

export interface Reaction {
	emoji: string;
	people: string[];
}

/** A transcript entry's reaction key: DM messages are entries in a person's own transcript, not thread messages. */
export const entryReaction = (session: string, entry: string) => `entry:${session}:${entry}`;

/** Add or remove `actor`'s `emoji` on a message; the operator may react anywhere, a person only where it takes part. */
export function react(
	db: DatabaseSync,
	actor: string,
	operator: string,
	command: { message: string; emoji: string; on: boolean },
	now: number,
): void {
	const emoji = command.emoji.trim();
	if (!emoji || /\s/.test(emoji)) throw new Error("A reaction is one emoji.");
	const entry = /^entry:([^:]+):(.+)$/.exec(command.message);
	if (entry) {
		// A DM is the operator's conversation with one person: only the operator reacts there.
		if (actor !== operator) throw new Error("Only the operator reacts in a direct conversation.");
		if (!db.prepare("select 1 from messages where session_id = ? and entry_id = ?").get(entry[1], entry[2]))
			throw new Error(`No message ${command.message}.`);
	} else {
		const row = db.prepare("select thread_id from thread_messages where id = ?").get(command.message) as
			| { thread_id: string }
			| undefined;
		if (!row) throw new Error(`No message ${command.message}.`);
		if (
			actor !== operator &&
			!db.prepare("select 1 from thread_participants where thread_id = ? and participant = ?").get(row.thread_id, actor)
		)
			throw new Error("You are not in that conversation.");
	}
	if (command.on)
		db.prepare(
			"insert into message_reactions (message_id, person, emoji, at) values (?, ?, ?, ?) on conflict do nothing",
		).run(command.message, actor, emoji, now);
	else
		db.prepare("delete from message_reactions where message_id = ? and person = ? and emoji = ?").run(
			command.message,
			actor,
			emoji,
		);
}

/** Databases known to have the table; one opened before the migration keeps checking until it appears. */
const known = new WeakSet<DatabaseSync>();

/** A message's reactions, each emoji with who chose it, in the order first chosen; empty before the table exists. */
export function reactionsOf(db: DatabaseSync, message: string): Reaction[] {
	if (!known.has(db)) {
		if (!db.prepare("select 1 from sqlite_master where type = 'table' and name = 'message_reactions'").get()) return [];
		known.add(db);
	}
	const reactions = new Map<string, string[]>();
	for (const row of db
		.prepare("select emoji, person from message_reactions where message_id = ? order by at, rowid")
		.all(message) as { emoji: string; person: string }[])
		reactions.set(row.emoji, [...(reactions.get(row.emoji) ?? []), row.person]);
	return [...reactions].map(([emoji, people]) => ({ emoji, people }));
}
