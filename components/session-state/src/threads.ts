/**
 * Threads: every exchange between people is a thread with a subject, participants, and ordered messages, stored by
 * the runtime (the only writer). A participant is pushed new messages (each arrives as mail, a turn) or pulls them
 * (they wait until it reads the thread). Readers in sessions open the database read-only.
 */
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { statePaths } from "./paths.js";

export type ThreadKind = "mail" | "escalation" | "channel" | "meeting" | "task";
export type Delivery = "push" | "pull";

/** The operator, as a participant and an address. */
export const OPERATOR = "operator";

/** What a `thread_post` command asks the runtime to do. */
export interface ThreadPost {
	thread: string;
	body: string;
	/** For a new thread: its subject, kind, and recipients (session ids, or the operator). */
	subject?: string;
	threadKind?: ThreadKind;
	to?: string[];
	cc?: string[];
	/** The organizer ends a meeting by posting its summary and closing it together. */
	closeMeeting?: boolean;
}

export interface Posted {
	thread: string;
	subject: string;
	seq: number;
	/** Participants to push the message to, besides the sender. */
	push: string[];
}

const known = (db: DatabaseSync, id: string) =>
	id === OPERATOR || db.prepare("select 1 from sessions where id = ?").get(id) !== undefined;

/** Change access and its audience-history fact atomically, including when called without an outer transaction. */
export function participateIn(
	db: DatabaseSync,
	thread: string,
	person: string,
	now: number,
	delivery: Delivery | null,
): void {
	db.exec("savepoint participation");
	try {
		const result =
			delivery === null
				? db.prepare("delete from thread_participants where thread_id = ? and participant = ?").run(thread, person)
				: db
						.prepare(
							"insert into thread_participants (thread_id, participant, delivery, read_up_to, joined_at) values (?, ?, ?, 0, ?) on conflict do nothing",
						)
						.run(thread, person, delivery, now);
		if (result.changes)
			db.prepare("insert into events (at, source, session_id, type, data) values (?, 'runtime', ?, ?, ?)").run(
				now,
				person,
				delivery === null ? "thread_left" : "thread_joined",
				JSON.stringify({ thread }),
			);
		db.exec("release participation");
	} catch (error) {
		db.exec("rollback to participation; release participation");
		throw error;
	}
}

/** Audience at a timestamp, separate from today's access and read cursors. */
export function audienceAt(db: DatabaseSync, thread: string, at: number): string[] {
	const people = new Set<string>();
	const events = db
		.prepare(
			"select session_id, type from events where type in ('thread_joined', 'thread_left') and json_extract(data, '$.thread') = ? and at <= ? order by seq",
		)
		.all(thread, at) as { session_id: string; type: string }[];
	for (const event of events) {
		if (event.type === "thread_joined") people.add(event.session_id);
		else people.delete(event.session_id);
	}
	return [...people].sort();
}

/** Store one message (creating its thread when new); returns what to push, or why the post is refused. */
export function postToThread(
	db: DatabaseSync,
	sender: string,
	messageId: string,
	post: ThreadPost,
	now: number,
): Posted | string {
	if (typeof post.thread !== "string" || !post.thread) return "a post needs a thread id";
	if (typeof post.body !== "string" || !post.body) return "a post needs a body";
	const addresses = [...new Set([...(post.to ?? []), ...(post.cc ?? [])])].filter((id) => id !== sender);
	for (const id of addresses) if (!known(db, id)) return `nobody has the address ${id}`;
	const thread = db.prepare("select subject, kind, created_by, closed_at from threads where id = ?").get(post.thread) as
		| { subject: string; kind: ThreadKind; created_by: string; closed_at: number | null }
		| undefined;
	if (post.threadKind === "channel" && thread?.kind !== "channel") return "no team channel with that id";
	if (post.closeMeeting && thread?.kind !== "meeting") return "this is not a meeting";
	if (post.closeMeeting && thread?.created_by !== sender) return "only the organizer can end this meeting";
	if (!thread) {
		if (!post.subject) return "a new thread needs a subject";
		if (addresses.length === 0) return "a new thread needs someone to write to";
		db.prepare(
			"insert into threads (id, kind, subject, created_by, created_at, closed_at) values (?, ?, ?, ?, ?, null)",
		).run(post.thread, post.threadKind ?? "mail", post.subject, sender, now);
		participateIn(db, post.thread, sender, now, "push");
	} else {
		if (thread.closed_at !== null) return "the thread is closed";
		if (!isParticipant(db, post.thread, sender)) return "you are not in this thread";
	}
	for (const id of addresses) {
		participateIn(db, post.thread, id, now, thread?.kind === "channel" ? "pull" : "push");
		if (thread?.kind === "channel")
			db.prepare("update thread_participants set invited = 1 where thread_id = ? and participant = ?").run(
				post.thread,
				id,
			);
	}
	const { lastInsertRowid } = db
		.prepare("insert into thread_messages (id, thread_id, sender, body, at) values (?, ?, ?, ?, ?)")
		.run(messageId, post.thread, sender, post.body, now);
	const seq = Number(lastInsertRowid);
	if (post.closeMeeting) db.prepare("update threads set closed_at = ? where id = ?").run(now, post.thread);
	markRead(db, post.thread, sender, seq);
	const participants = db
		.prepare("select participant, delivery from thread_participants where thread_id = ? and participant != ?")
		.all(post.thread, sender) as { participant: string; delivery: Delivery }[];
	const push = participants
		.filter(
			({ participant, delivery }) =>
				delivery === "push" ||
				(thread?.kind === "channel" && mentions(post.body, [participant, nameOf(db, participant)])),
		)
		.map((row) => row.participant);
	return { thread: post.thread, subject: thread?.subject ?? (post.subject as string), seq, push };
}

/** A complete name or id, not a substring of another word. An @ prefix is welcome but not required. */
function mentions(body: string, names: string[]): boolean {
	return names.some((name) => {
		const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp(`(?<![\\p{L}\\p{N}_-])${escaped}(?![\\p{L}\\p{N}_-])`, "iu").test(body);
	});
}

export function isParticipant(db: DatabaseSync, thread: string, participant: string): boolean {
	return (
		db.prepare("select 1 from thread_participants where thread_id = ? and participant = ?").get(thread, participant) !==
		undefined
	);
}

/** A participant has read the thread up to message `seq`. */
export function markRead(db: DatabaseSync, thread: string, participant: string, seq: number): void {
	db.prepare(
		"update thread_participants set read_up_to = max(read_up_to, ?) where thread_id = ? and participant = ?",
	).run(seq, thread, participant);
}

export interface ThreadSummary {
	id: string;
	kind: ThreadKind;
	subject: string;
	participants: { id: string; name: string }[];
	unread: number;
	last: { from: string; body: string; at: number } | null;
	closed: boolean;
}

export interface ThreadMessage {
	seq: number;
	id: string;
	from: string;
	fromName: string;
	body: string;
	at: number;
}

/** Read the state database read-only; undefined when it or its thread tables do not exist yet. */
export function withThreads<T>(read: (db: DatabaseSync) => T): T | undefined {
	const path = statePaths().db;
	if (!existsSync(path)) return undefined;
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		if (!db.prepare("select 1 from sqlite_master where type = 'table' and name = 'threads'").get()) return undefined;
		return read(db);
	} finally {
		db.close();
	}
}

/** A participant's display name: its session name, else its id; the operator is "the operator". */
export function nameOf(db: DatabaseSync, id: string): string {
	if (id === OPERATOR) return "the operator";
	const row = db.prepare("select name from sessions where id = ?").get(id) as { name: string | null } | undefined;
	return row?.name || id;
}

/** The threads `participant` is in, newest activity first; with `unreadOnly`, only those with unread messages. */
export function threadsOf(db: DatabaseSync, participant: string, unreadOnly: boolean): ThreadSummary[] {
	const rows = db
		.prepare(
			`select t.id, t.kind, t.subject, t.closed_at, p.read_up_to,
				(select count(*) from thread_messages m where m.thread_id = t.id and m.seq > p.read_up_to and m.sender != ?) as unread,
				(select max(m.seq) from thread_messages m where m.thread_id = t.id) as last_seq
			from threads t join thread_participants p on p.thread_id = t.id and p.participant = ?
			order by last_seq desc`,
		)
		.all(participant, participant) as {
		id: string;
		kind: ThreadKind;
		subject: string;
		closed_at: number | null;
		unread: number;
		last_seq: number | null;
	}[];
	const people = db.prepare("select participant from thread_participants where thread_id = ? order by joined_at");
	const lastOf = db.prepare("select sender, body, at from thread_messages where seq = ?");
	return rows
		.filter((row) => !unreadOnly || row.unread > 0)
		.map((row) => {
			const last =
				row.last_seq === null ? undefined : (lastOf.get(row.last_seq) as ThreadSummary["last"] & { sender: string });
			return {
				id: row.id,
				kind: row.kind,
				subject: row.subject,
				participants: (people.all(row.id) as { participant: string }[]).map(({ participant }) => ({
					id: participant,
					name: nameOf(db, participant),
				})),
				unread: row.unread,
				last: last ? { from: nameOf(db, last.sender), body: last.body, at: last.at } : null,
				closed: row.closed_at !== null,
			};
		});
}

/** Every message of a thread, in order. */
export function messagesOf(db: DatabaseSync, thread: string): ThreadMessage[] {
	const rows = db
		.prepare("select seq, id, sender, body, at from thread_messages where thread_id = ? order by seq")
		.all(thread) as { seq: number; id: string; sender: string; body: string; at: number }[];
	return rows.map((row) => ({
		seq: row.seq,
		id: row.id,
		from: row.sender,
		fromName: nameOf(db, row.sender),
		body: row.body,
		at: row.at,
	}));
}

export function threadOf(
	db: DatabaseSync,
	thread: string,
): { id: string; kind: ThreadKind; subject: string; closed: boolean } | undefined {
	const row = db.prepare("select id, kind, subject, closed_at from threads where id = ?").get(thread) as
		| { id: string; kind: ThreadKind; subject: string; closed_at: number | null }
		| undefined;
	return row ? { id: row.id, kind: row.kind, subject: row.subject, closed: row.closed_at !== null } : undefined;
}
