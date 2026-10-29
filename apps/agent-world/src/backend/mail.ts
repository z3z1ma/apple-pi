// Mail between sessions, as the rookery and the Mail tab show it: the runtime's `mail` view (one row per `mail`
// command), newest first, with every mail still waiting however old. A mail is delivered once the receiver's
// transcript records it; until then it waits (a dormant receiver gets it when it wakes).
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Command } from "../../../../components/session-state/src/protocol.js";
import { nameOf as retainedName } from "../../../../components/session-state/src/threads.js";
import type { CommandReceipt, ThreadRead } from "../world.js";
import { MAIL_BODY_MAX, type MailItem, type MailThread, type MailThreadSummary, OPERATOR } from "../world.js";
import type { Commands } from "./commands.js";

/** Recent mail kept in the snapshot, besides every mail still waiting. */
export const MAIL_KEPT = 120;

export interface Mailbox {
	sendMail(characterId: string, body: string): Promise<CommandReceipt>;
	readThread(thread: string): Promise<ThreadRead>;
	replyThread(thread: string, body: string): Promise<CommandReceipt>;
}

export function openMailbox(path: string, commands: Commands): Mailbox {
	const send = async (command: Command): Promise<CommandReceipt> => {
		let note: string | undefined;
		const result = await commands.send(OPERATOR, command, {
			onReceipt(stage, reason) {
				if (stage === "applied") note = reason;
			},
		});
		return result.ok ? { ok: true, stage: "applied", ...(note ? { note } : {}) } : result;
	};
	return {
		async sendMail(characterId, body) {
			if (!body.trim()) return { ok: false, reason: "The message is empty." };
			return send({
				kind: "thread_post",
				thread: `t-${randomUUID()}`,
				subject: "Message from the operator",
				to: [characterId],
				body: body.trim(),
			});
		},
		async replyThread(thread, body) {
			if (!body.trim()) return { ok: false, reason: "The message is empty." };
			return send({ kind: "thread_post", thread, body: body.trim() });
		},
		async readThread(id) {
			if (!existsSync(path)) return { ok: false, reason: "The session database is not available." };
			const db = new DatabaseSync(path);
			let thread: MailThread | undefined;
			try {
				db.exec("pragma query_only = 1");
				thread = readOperatorThread(db, id);
			} finally {
				db.close();
			}
			if (!thread) return { ok: false, reason: "You are not a participant in this thread, or it does not exist." };
			const last = thread.messages.at(-1);
			if (last) {
				const receipt = await send({ kind: "thread_read", thread: id, seq: last.seq });
				if (!receipt.ok) return receipt;
			}
			return { ok: true, thread };
		},
	};
}

const MAIL = `select m.id, m.sender, m.receiver, m.body, m.sent_at as sentAt, m.delivered_at as deliveredAt, m.stage,
	m.reason, fs.name as fromName, fs.cwd as fromCwd, ts.name as toName, ts.cwd as toCwd
from mail m
left join sessions fs on fs.id = m.sender
left join sessions ts on ts.id = m.receiver
where m.id in (select id from mail order by sent_at desc limit ${MAIL_KEPT})
	or m.stage in ('accepted', 'delivered')
order by m.sent_at desc, m.id`;

interface MailRow {
	id: string;
	sender: string | null;
	receiver: string;
	body: string | null;
	sentAt: number;
	deliveredAt: number | null;
	stage: string;
	reason: string | null;
	fromName: string | null;
	fromCwd: string | null;
	toName: string | null;
	toCwd: string | null;
}

const nameOf = (db: DatabaseSync, id: string, name: string | null, cwd: string | null) =>
	name || (cwd ? cwd.split("/").filter(Boolean).pop() : undefined) || (id === OPERATOR ? id : retainedName(db, id));

const hasThreads = (db: DatabaseSync) =>
	db.prepare("select 1 from sqlite_master where type = 'table' and name = 'thread_messages'").get() !== undefined;

/** The operator is not a session row: its needs-you state is its unread thread cursor. */
export function readOperatorMail(db: DatabaseSync): MailThreadSummary[] {
	if (!hasThreads(db)) return [];
	return db
		.prepare(`select t.id, t.subject, max(m.at) as lastAt,
		count(case when m.seq > p.read_up_to and m.sender != ? then 1 end) as unread
		from threads t join thread_participants p on p.thread_id = t.id and p.participant = ?
		join thread_messages m on m.thread_id = t.id group by t.id order by lastAt desc`)
		.all(OPERATOR, OPERATOR) as unknown as MailThreadSummary[];
}

/** Read a thread only if the operator participates. The caller marks the returned sequence read through the runtime. */
export function readOperatorThread(db: DatabaseSync, id: string): MailThread | undefined {
	if (!hasThreads(db)) return undefined;
	const participant = db
		.prepare("select read_up_to from thread_participants where thread_id = ? and participant = ?")
		.get(id, OPERATOR) as { read_up_to: number } | undefined;
	if (!participant) return undefined;
	const thread = readStoredThread(db, id);
	return thread ? { ...thread, readUpTo: participant.read_up_to } : undefined;
}

/** The stored conversation. Its caller decides whether this is a participant read or a shared-board observation. */
export function readStoredThread(db: DatabaseSync, id: string): MailThread | undefined {
	const row = db.prepare("select subject, closed_at from threads where id = ?").get(id) as
		| { subject: string; closed_at: number | null }
		| undefined;
	if (!row) return undefined;
	const participants = db
		.prepare(`select p.participant as id, coalesce(s.name, p.participant) as name
		from thread_participants p left join sessions s on s.id = p.participant where p.thread_id = ? order by p.joined_at`)
		.all(id) as { id: string; name: string }[];
	const messages = db
		.prepare(`select m.seq, m.sender as "from", coalesce(s.name, m.sender) as name, m.body, m.at
		from thread_messages m left join sessions s on s.id = m.sender where m.thread_id = ? order by m.seq`)
		.all(id) as MailThread["messages"];
	for (const participant of participants)
		if (participant.name === participant.id && participant.id !== OPERATOR)
			participant.name = retainedName(db, participant.id);
	for (const message of messages)
		if (message.name === message.from && message.from !== OPERATOR) message.name = retainedName(db, message.from);
	return { id, subject: row.subject, closed: row.closed_at !== null, participants, messages };
}

/** The mail the world shows now. */
export function readMail(db: DatabaseSync): MailItem[] {
	const rows = db.prepare(MAIL).all() as unknown as MailRow[];
	return rows.map((row) => {
		const from = row.sender ?? "someone";
		const body = row.body ?? "";
		return {
			id: row.id,
			from,
			fromName: from === OPERATOR ? "You" : nameOf(db, from, row.fromName, row.fromCwd),
			to: row.receiver,
			toName: nameOf(db, row.receiver, row.toName, row.toCwd),
			body: body.length > MAIL_BODY_MAX ? `${body.slice(0, MAIL_BODY_MAX - 1)}\u2026` : body,
			sentAt: row.sentAt,
			deliveredAt: row.deliveredAt,
			state: row.stage === "applied" ? "delivered" : row.stage === "failed" ? "failed" : "waiting",
			reason: row.reason,
		};
	});
}
