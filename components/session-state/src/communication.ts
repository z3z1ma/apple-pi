import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type {
	ChannelFindOptions,
	CommunicationAttempt,
	CommunicationCommand,
	CommunicationInput,
	ConversationInboxOptions,
	ConversationInfo,
	ConversationList,
	ConversationMessage,
	ConversationPage,
	ConversationReadOptions,
	MessageReference,
	MessageSearchOptions,
	MessageSearchResult,
} from "./communication-types.js";
import { departureOf } from "./departures.js";
import { temporaryCallers } from "./program-peers.js";
import { nameOf, OPERATOR, type ThreadKind } from "./threads.js";

export type * from "./communication-types.js";

export function communicationAvailable(db: DatabaseSync): boolean {
	return db
		.prepare("pragma table_info(commands)")
		.all()
		.some((row) => row.name === "result");
}

export function requireCommunication(db: DatabaseSync): void {
	if (!communicationAvailable(db))
		throw new Error("Restart the session runtime with current code before using communication capabilities.");
}

export function communicationAttemptId(person: string, invocation: string): string {
	return `communication:${createHash("sha256")
		.update(JSON.stringify([person, invocation]))
		.digest("hex")}`;
}

export function canonicalCommunication(value: unknown): string {
	return JSON.stringify(value, (_key, item) =>
		item && typeof item === "object" && !Array.isArray(item)
			? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
			: item,
	);
}

export function communicationAttempt(
	db: DatabaseSync,
	person: string,
	attempt: string,
	input?: CommunicationInput,
): CommunicationAttempt {
	requireCommunication(db);
	const row = db
		.prepare("select session_id, kind, command, stage, reason, result from commands where command_id = ?")
		.get(attempt) as
		| {
				session_id: string;
				kind: string;
				command: string;
				stage: "accepted" | "delivered" | "applied" | "failed";
				reason: string | null;
				result: string | null;
		  }
		| undefined;
	if (!row) return { attempt, outcome: "not_recorded" };
	if (row.session_id !== person || row.kind !== "communication")
		throw new Error("This communication attempt belongs to another caller or operation.");
	const command = JSON.parse(row.command) as CommunicationCommand;
	if (input && canonicalCommunication(input) !== canonicalCommunication(command.input))
		throw new Error("The attempt already records a different input; use a new invocation for changed intent.");
	return {
		attempt,
		outcome: row.stage === "applied" ? "applied" : row.stage === "failed" ? "refused" : "pending",
		stage: row.stage,
		...(row.reason ? { reason: row.reason } : {}),
		command,
		...(row.result ? { effect: JSON.parse(row.result) } : {}),
	};
}

export interface ConversationRow {
	id: string;
	kind: ThreadKind;
	subject: string;
	created_by: string;
	closed_at: number | null;
	channel_type: "topic" | "team" | "organization" | null;
	purpose: string | null;
	scope_head: string | null;
	pinned_seq: number | null;
}

export function conversationRow(db: DatabaseSync, id: string): ConversationRow {
	requireCommunication(db);
	const row = db.prepare("select * from threads where id = ?").get(id) as unknown as ConversationRow | undefined;
	if (!row) throw new Error(`No conversation ${id}.`);
	return row;
}

export function conversationInfo(db: DatabaseSync, person: string, id: string): ConversationInfo {
	const row = conversationRow(db, id);
	const memberships = db
		.prepare("select participant, invited, following, read_up_to from thread_participants where thread_id = ?")
		.all(id) as { participant: string; invited: number; following: number; read_up_to: number }[];
	const mine = memberships.find((member) => member.participant === person);
	const active =
		person === OPERATOR ||
		(Boolean(db.prepare("select 1 from sessions where id = ? and retired_at is null").get(person)) &&
			!departureOf(db, person));
	const orphan = !memberships.some(
		(member) =>
			member.participant !== OPERATOR &&
			db.prepare("select 1 from sessions where id = ? and retired_at is null").get(member.participant),
	);
	const operatorAccess =
		person === OPERATOR && (row.kind === "channel" || row.kind === "meeting" || row.kind === "task" || orphan);
	const access = active && Boolean(mine || operatorAccess);
	const sources = access ? accessSources(db, row, person, Boolean(mine?.invited), operatorAccess) : [];
	const following = row.kind === "channel" ? Boolean(mine?.following) : null;
	const participant =
		access && ((person === OPERATOR && orphan) || (row.kind === "channel" ? Boolean(following) : Boolean(mine)));
	const ordinary = row.kind !== "task" && (row.kind !== "channel" || row.channel_type === "topic");
	const pinned = row.pinned_seq === null ? null : messageReference(db, id, row.pinned_seq);
	const readUpTo = mine?.read_up_to ?? 0;
	const unread = access
		? (
				db
					.prepare("select count(*) as count from thread_messages where thread_id = ? and seq > ? and sender != ?")
					.get(id, readUpTo, person) as { count: number }
			).count
		: 0;
	const participantInfo = (member: (typeof memberships)[number]) => ({
		id: member.participant,
		name: nameOf(db, member.participant),
		access_sources: accessSources(
			db,
			row,
			member.participant,
			Boolean(member.invited),
			member.participant === OPERATOR,
		),
		following: row.kind === "channel" ? Boolean(member.following) : null,
	});
	return {
		id,
		kind: row.kind,
		channel_type: row.channel_type,
		name: row.subject,
		purpose: row.purpose,
		scope_head:
			row.scope_head ??
			(row.channel_type === "organization"
				? id.slice("organization:".length)
				: row.channel_type === "team"
					? id.slice("team:".length)
					: null),
		archived: row.closed_at !== null,
		pinned,
		access,
		access_sources: sources,
		following,
		read_up_to: readUpTo,
		unread,
		participants: access
			? memberships.filter((member) => row.kind !== "channel" || member.following).map(participantInfo)
			: [],
		invitations: access ? memberships.filter((member) => member.invited).map(participantInfo) : [],
		permissions: {
			post:
				access &&
				row.closed_at === null &&
				(row.kind === "channel" ? row.channel_type === "topic" || Boolean(mine) : row.kind !== "task" || Boolean(mine)),
			join: access && row.kind === "channel",
			invite: participant && row.kind !== "task",
			remove: participant && row.kind !== "task",
			pin: participant,
			archive: participant && ordinary && row.closed_at === null,
			reopen: participant && ordinary && row.closed_at !== null,
		},
	};
}

function accessSources(
	db: DatabaseSync,
	row: ConversationRow,
	person: string,
	invited: boolean,
	operator: boolean,
): string[] {
	if (operator) return ["operator"];
	if (row.kind !== "channel") return ["membership"];
	const derived =
		row.channel_type === "team"
			? person === row.scope_head ||
				(
					db.prepare("select reports_to from sessions where id = ?").get(person) as
						| { reports_to: string | null }
						| undefined
				)?.reports_to === row.scope_head
			: scopeAccess(db, person, row.scope_head);
	return [
		...(invited ? ["explicit_invitation"] : []),
		...(derived ? [row.channel_type === "topic" ? "organization" : "structural"] : []),
	];
}

export function requireConversationAccess(db: DatabaseSync, person: string, id: string): ConversationInfo {
	const info = conversationInfo(db, person, id);
	if (!info.access) throw new Error("You do not have access to this conversation.");
	return info;
}

export function scopeAccess(db: DatabaseSync, person: string, head: string | null): boolean {
	if (!head || temporaryCallers(db).has(person)) return false;
	const seen = new Set<string>();
	let current: string | null = person;
	while (current && !seen.has(current)) {
		if (current === head) return true;
		seen.add(current);
		current =
			(
				db.prepare("select reports_to from sessions where id = ?").get(current) as
					| { reports_to: string | null }
					| undefined
			)?.reports_to ?? null;
	}
	return false;
}

export function messageReference(db: DatabaseSync, thread: string, seq: number): MessageReference {
	const message = db.prepare("select id from thread_messages where thread_id = ? and seq = ?").get(thread, seq) as
		| { id: string }
		| undefined;
	if (!message) throw new Error("The message reference does not belong to this conversation.");
	return { thread, seq, id: message.id };
}

function message(
	db: DatabaseSync,
	thread: string,
	row: { seq: number; id: string; sender: string; body: string; at: number },
): ConversationMessage {
	return {
		thread,
		seq: row.seq,
		id: row.id,
		from: row.sender,
		fromName: nameOf(db, row.sender),
		body: row.body,
		at: row.at,
		reference: { thread, seq: row.seq, id: row.id },
	};
}

function positive(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1) throw new Error("limit must be a positive safe integer.");
}

interface Continuation {
	person: string;
	kind: string;
	query: Record<string, unknown>;
	position: number;
	through: number;
}
function continuation(person: string, kind: string, options: object & { cursor?: string }): Continuation | undefined {
	if (!options.cursor) return undefined;
	let decoded: Continuation;
	try {
		decoded = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"));
	} catch {
		throw new Error("Invalid continuation cursor.");
	}
	if (
		decoded.person !== person ||
		decoded.kind !== kind ||
		!decoded.query ||
		!Number.isSafeInteger(decoded.position) ||
		!Number.isSafeInteger(decoded.through)
	)
		throw new Error("This continuation belongs to another caller or query.");
	for (const [key, value] of Object.entries(options)) {
		if (
			key !== "cursor" &&
			value !== undefined &&
			canonicalCommunication(value) !== canonicalCommunication(decoded.query[key])
		)
			throw new Error("Continuation parameters differ from the original query.");
	}
	return decoded;
}
function cursor(value: Continuation): string {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function conversationInbox(
	db: DatabaseSync,
	person: string,
	options: ConversationInboxOptions = {},
): ConversationList {
	requireCommunication(db);
	const resumed = continuation(person, "inbox", options);
	const query = resumed?.query ?? {
		all: options.all ?? false,
		...(options.limit === undefined ? {} : { limit: options.limit }),
	};
	const limit = query.limit as number | undefined;
	if (limit !== undefined) positive(limit);
	const rows = accessible(db, person).filter(
		(info) => (info.kind !== "channel" || info.following) && (query.all || info.unread > 0),
	);
	const start = resumed?.position ?? 0;
	const threads = limit === undefined ? rows.slice(start) : rows.slice(start, start + limit);
	return {
		threads,
		...(start + threads.length < rows.length
			? { next_cursor: cursor({ person, kind: "inbox", query, position: start + threads.length, through: 0 }) }
			: {}),
	};
}

export function findChannels(db: DatabaseSync, person: string, options: ChannelFindOptions): ConversationList {
	requireCommunication(db);
	const resumed = continuation(person, "channels", options);
	const query = resumed?.query ?? { ...options, cursor: undefined, archived: options.archived ?? "exclude" };
	positive(query.limit as number);
	const needle = String(query.query ?? "").toLocaleLowerCase();
	const rows = accessible(db, person).filter(
		(info) =>
			info.kind === "channel" &&
			(!needle || `${info.name}\n${info.purpose ?? ""}`.toLocaleLowerCase().includes(needle)) &&
			(query.followed === undefined || info.following === query.followed) &&
			(!query.scopeHead || info.scope_head === query.scopeHead) &&
			(query.archived === "include" || info.archived === (query.archived === "only")),
	);
	const start = resumed?.position ?? 0;
	const threads = rows.slice(start, start + (query.limit as number));
	return {
		threads,
		...(start + threads.length < rows.length
			? { next_cursor: cursor({ person, kind: "channels", query, position: start + threads.length, through: 0 }) }
			: {}),
	};
}

function accessible(db: DatabaseSync, person: string): ConversationInfo[] {
	return (db.prepare("select id from threads order by id").all() as { id: string }[])
		.map(({ id }) => conversationInfo(db, person, id))
		.filter((info) => info.access);
}

export function readConversation(db: DatabaseSync, person: string, options: ConversationReadOptions): ConversationPage {
	const resumed = continuation(person, "read", options);
	const query = resumed?.query ?? {
		thread: options.thread,
		view: options.view ?? "catch_up",
		limit: options.limit,
		...(options.after === undefined ? {} : { after: options.after }),
		...(options.through === undefined ? {} : { through: options.through }),
	};
	positive(query.limit as number);
	const thread = requireConversationAccess(db, person, String(query.thread));
	const view = query.view;
	if (view !== "catch_up" && view !== "recent" && view !== "range") throw new Error("Unknown conversation view.");
	if (view !== "range" && (query.after !== undefined || query.through !== undefined))
		throw new Error("after and through apply only to range inspection.");
	if (view === "catch_up" && thread.kind === "channel" && !thread.following)
		throw new Error("Join this channel before reading catch-up, or inspect with recent/range.");
	for (const bound of [query.after, query.through])
		if (bound !== undefined && (!Number.isSafeInteger(bound) || Number(bound) < 0))
			throw new Error("Message bounds must be nonnegative safe integers.");
	if (view === "catch_up" && resumed && resumed.position > thread.read_up_to)
		throw new Error("Catch-up continuation has a gap beyond the confirmed read cursor; begin at the current cursor.");
	const maximum = (
		db.prepare("select coalesce(max(seq),0) as seq from thread_messages where thread_id = ?").get(thread.id) as {
			seq: number;
		}
	).seq;
	const through = resumed?.through ?? Math.min(maximum, Number(query.through ?? maximum));
	const after = resumed?.position ?? (view === "catch_up" ? thread.read_up_to : Number(query.after ?? 0));
	const backward = view === "recent";
	const rows = db
		.prepare(
			`select seq,id,sender,body,at from thread_messages where thread_id = ? and seq <= ? and seq > ? ${backward && resumed ? "and seq < ?" : ""} order by seq ${backward ? "desc" : "asc"} limit ?`,
		)
		.all(
			thread.id,
			through,
			backward ? 0 : after,
			...(backward && resumed ? [after] : []),
			Number(query.limit) + 1,
		) as { seq: number; id: string; sender: string; body: string; at: number }[];
	const more = rows.length > Number(query.limit);
	const selected = rows.slice(0, Number(query.limit));
	const next = selected.at(-1)?.seq;
	if (backward) selected.reverse();
	return {
		thread,
		view,
		messages: selected.map((row) => message(db, thread.id, row)),
		window_through: through,
		acknowledgment: "not_requested",
		acknowledged_through: null,
		last_confirmed_cursor: thread.read_up_to,
		...(more && next !== undefined
			? { next_cursor: cursor({ person, kind: "read", query, position: next, through }) }
			: {}),
	};
}

export function searchMessages(db: DatabaseSync, person: string, options: MessageSearchOptions): MessageSearchResult {
	requireCommunication(db);
	const resumed = continuation(person, "search", options);
	const query = resumed?.query ?? {
		query: options.query,
		limit: options.limit,
		...(options.thread ? { thread: options.thread } : {}),
	};
	positive(query.limit as number);
	if (typeof query.query !== "string" || !query.query.trim()) throw new Error("Search needs nonempty plain text.");
	if (query.thread) requireConversationAccess(db, person, String(query.thread));
	const ids = new Set(
		accessible(db, person)
			.filter((info) => !query.thread || info.id === query.thread)
			.map((info) => info.id),
	);
	const through =
		resumed?.through ??
		(db.prepare("select coalesce(max(seq),0) as seq from thread_messages").get() as { seq: number }).seq;
	const rows = db
		.prepare("select thread_id,seq,id,sender,body,at from thread_messages where seq > ? and seq <= ? order by seq")
		.all(resumed?.position ?? 0, through) as {
		thread_id: string;
		seq: number;
		id: string;
		sender: string;
		body: string;
		at: number;
	}[];
	const matches = rows.filter(
		(row) => ids.has(row.thread_id) && row.body.toLocaleLowerCase().includes(String(query.query).toLocaleLowerCase()),
	);
	const selected = matches.slice(0, Number(query.limit));
	return {
		messages: selected.map((row) => message(db, row.thread_id, row)),
		...(matches.length > selected.length
			? { next_cursor: cursor({ person, kind: "search", query, position: selected.at(-1)!.seq, through }) }
			: {}),
	};
}
