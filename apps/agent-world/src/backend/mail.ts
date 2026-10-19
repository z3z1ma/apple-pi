// Mail between sessions, as the rookery and the Mail tab show it: the runtime's `mail` view (one row per `mail`
// command), newest first, with every mail still waiting however old. A mail is delivered once the receiver's
// transcript records it; until then it waits (a dormant receiver gets it when it wakes).
import type { DatabaseSync } from "node:sqlite";
import { MAIL_BODY_MAX, type MailItem, OPERATOR } from "../world.js";

/** Recent mail kept in the snapshot, besides every mail still waiting. */
export const MAIL_KEPT = 120;

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

const nameOf = (id: string, name: string | null, cwd: string | null) =>
	name || (cwd ? cwd.split("/").filter(Boolean).pop() : undefined) || id;

/** The mail the world shows now. */
export function readMail(db: DatabaseSync): MailItem[] {
	const rows = db.prepare(MAIL).all() as unknown as MailRow[];
	return rows.map((row) => {
		const from = row.sender ?? "someone";
		const body = row.body ?? "";
		return {
			id: row.id,
			from,
			fromName: from === OPERATOR ? "You" : nameOf(from, row.fromName, row.fromCwd),
			to: row.receiver,
			toName: nameOf(row.receiver, row.toName, row.toCwd),
			body: body.length > MAIL_BODY_MAX ? `${body.slice(0, MAIL_BODY_MAX - 1)}\u2026` : body,
			sentAt: row.sentAt,
			deliveredAt: row.deliveredAt,
			state: row.stage === "applied" ? "delivered" : row.stage === "failed" ? "failed" : "waiting",
			reason: row.reason,
		};
	});
}
