/**
 * Channel charters: a channel can name a listener, who is pushed every post in it, and a charter, a standing policy the
 * listener applies to those posts (for example: reproduce reported bugs silently and post only confirmed fixes). This
 * turns recurring routing into policy without a new engine: delivery is the ordinary channel mail.
 */

import type { DatabaseSync } from "node:sqlite";

export interface Charter {
	listener: string | null;
	charter: string | null;
}

export function charterOf(db: DatabaseSync, thread: string): Charter | undefined {
	const row = db.prepare("select kind, listener, charter from threads where id = ?").get(thread) as
		| { kind: string; listener: string | null; charter: string | null }
		| undefined;
	return row?.kind === "channel" ? { listener: row.listener, charter: row.charter } : undefined;
}

/**
 * Set or clear a channel's listener and charter. The operator, the channel's scope head and managing people may set
 * them; the listener must be a current person. The runtime records the event, as for its other commands.
 */
export function setCharter(db: DatabaseSync, actor: string, operator: string, thread: string, next: Charter): void {
	const row = db.prepare("select kind, scope_head from threads where id = ?").get(thread) as
		| { kind: string; scope_head: string | null }
		| undefined;
	if (row?.kind !== "channel") throw new Error(`No channel ${thread}.`);
	const manages =
		(db.prepare("select manages from sessions where id = ?").get(actor) as { manages: number | null } | undefined)
			?.manages === 1;
	if (actor !== operator && actor !== row.scope_head && !manages)
		throw new Error("Only the operator, the channel's head or a manager can set its charter.");
	if (
		next.listener &&
		!db.prepare("select 1 from sessions where id = ? and kind = 'root' and retired_at is null").get(next.listener)
	)
		throw new Error(`No current person ${next.listener}.`);
	db.prepare("update threads set listener = ?, charter = ? where id = ?").run(
		next.listener,
		next.charter?.trim() || null,
		thread,
	);
}

/** The body a listener receives: the post, then the charter it applies. */
export function chartered(body: string, charter: string | null): string {
	return charter ? `${body}\n\nChannel charter (you listen here): ${charter}` : body;
}
