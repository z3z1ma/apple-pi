import type { DatabaseSync } from "node:sqlite";
import { syncChannels } from "./channels.js";
import { conversationInfo, messageReference, readConversation, requireConversationAccess } from "./communication.js";
import type {
	CommunicationEffect,
	CommunicationOperation,
	ConversationMessage,
	InvitationEffect,
} from "./communication-types.js";
import { departureOf } from "./departures.js";
import { temporaryCallers } from "./program-peers.js";
import { markRead, OPERATOR, participateIn, type ThreadPost } from "./threads.js";
import { rootOf } from "./tree.js";

export interface Publication {
	message: ConversationMessage;
	audience: string[];
	queued: string[];
}
export type PublishCommunication = (post: ThreadPost, suffix?: string, sender?: string) => Publication;

function people(db: DatabaseSync, ids: string[]): string[] {
	if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id))
		throw new Error("Recipients must be person IDs.");
	for (const id of ids)
		if (
			id !== OPERATOR &&
			(!db.prepare("select 1 from sessions where id = ? and retired_at is null").get(id) || departureOf(db, id))
		)
			throw new Error(`No current person ${id}.`);
	return [...new Set(ids)];
}

function nonempty(value: string, label: string): string {
	if (typeof value !== "string" || !value.trim()) throw new Error(`${label} must be nonempty text.`);
	return value.trim();
}

function invite(
	db: DatabaseSync,
	actor: string,
	thread: string,
	recipients: string[],
	now: number,
): InvitationEffect[] {
	const info = requireConversationAccess(db, actor, thread);
	if (!info.permissions.invite)
		throw new Error(
			"Only a current conversation member or joined channel participant can invite; task audiences remain work-owned.",
		);
	if (actor === OPERATOR) participateIn(db, thread, actor, now, "pull", false);
	const effects = people(db, recipients).map((person) => {
		const before = db
			.prepare("select invited from thread_participants where thread_id = ? and participant = ?")
			.get(thread, person) as { invited: number } | undefined;
		participateIn(db, thread, person, now, info.kind === "channel" ? "pull" : "push");
		if (info.kind === "channel")
			db.prepare(
				"update thread_participants set invited = 1, following = 1 where thread_id = ? and participant = ?",
			).run(thread, person);
		const current = conversationInfo(db, person, thread);
		return {
			person,
			...(info.kind === "channel" ? { explicit_invitation_added: !before?.invited } : { membership_added: !before }),
			access: current.access,
			access_sources: current.access_sources,
			following: current.following,
		};
	});
	return effects;
}

function createChannel(
	db: DatabaseSync,
	actor: string,
	operation: Extract<CommunicationOperation, { action: "create_channel" }>,
	now: number,
	id: string,
): CommunicationEffect {
	const name = nonempty(operation.name, "Channel name");
	const purpose = nonempty(operation.purpose, "Channel purpose");
	const callers = temporaryCallers(db);
	let owner = actor;
	for (const seen = new Set<string>(); callers.has(owner) && !seen.has(owner); ) {
		seen.add(owner);
		owner = callers.get(owner)!;
	}
	if (actor !== OPERATOR && operation.scopeHead !== undefined)
		throw new Error("Only the operator selects a scope head; agent channels use their own organization.");
	const head = actor === OPERATOR ? operation.scopeHead : rootOf(db, owner);
	if (
		!head ||
		!db.prepare("select 1 from sessions where id = ? and reports_to is null and retired_at is null").get(head) ||
		callers.has(head) ||
		departureOf(db, head)
	)
		throw new Error("A channel needs a current lasting organization head.");
	const thread = `topic:${id}`;
	db.prepare(
		"insert into threads (id,kind,subject,created_by,created_at,channel_type,purpose,scope_head) values (?,'channel',?,?,?,'topic',?,?)",
	).run(thread, name, actor, now, purpose, head);
	syncChannels(db, now);
	participateIn(db, thread, actor, now, "pull");
	db.prepare("update thread_participants set following = 1, invited = ? where thread_id = ? and participant = ?").run(
		Number(callers.has(actor)),
		thread,
		actor,
	);
	const recipients = invite(db, actor, thread, operation.invite ?? [], now);
	return { action: operation.action, thread: conversationInfo(db, actor, thread), people: recipients };
}

function removeInvitations(
	db: DatabaseSync,
	actor: string,
	thread: string,
	recipients: string[],
	now: number,
): InvitationEffect[] {
	const info = requireConversationAccess(db, actor, thread);
	if (!info.permissions.remove)
		throw new Error(
			"Only current members or joined channel participants can remove invitations; task audiences remain work-owned.",
		);
	return people(db, recipients).map((person) => {
		const before = db
			.prepare("select invited from thread_participants where thread_id = ? and participant = ?")
			.get(thread, person) as { invited: number } | undefined;
		if (info.kind === "channel") {
			db.prepare("update thread_participants set invited = 0 where thread_id = ? and participant = ?").run(
				thread,
				person,
			);
			syncChannels(db, now);
		} else participateIn(db, thread, person, now, null);
		const current = conversationInfo(db, person, thread);
		return {
			person,
			...(info.kind === "channel"
				? { explicit_invitation_removed: Boolean(before?.invited) }
				: { membership_removed: Boolean(before) }),
			access: current.access,
			access_sources: current.access_sources,
			following: current.following,
		};
	});
}

function publishPost(
	db: DatabaseSync,
	actor: string,
	operation: Extract<CommunicationOperation, { action: "post" }>,
	now: number,
	publish: PublishCommunication,
): CommunicationEffect {
	const existing = db.prepare("select kind from threads where id = ?").get(operation.thread) as
		| { kind: string }
		| undefined;
	const to = people(db, operation.to ?? []);
	const cc = people(db, operation.cc ?? []);
	const notify = people(db, operation.notify ?? []);
	nonempty(operation.body, "Message body");
	if (existing) {
		const info = requireConversationAccess(db, actor, operation.thread);
		if (!info.permissions.post)
			throw new Error("This conversation does not permit posting; reopen ordinary archived conversations first.");
		if (actor === OPERATOR) participateIn(db, operation.thread, actor, now, "pull", false);
		if (info.kind === "channel" && (to.length || cc.length))
			throw new Error("Invite channel participants explicitly; notify addresses only existing authorized people.");
		if (to.length || cc.length) invite(db, actor, operation.thread, [...to, ...cc], now);
	} else if (operation.threadKind && !["mail", "escalation"].includes(operation.threadKind))
		throw new Error("New conversations must be mail or escalation; use create_channel for a topic.");
	const publication = publish({ ...operation, to, cc, notify });
	return {
		action: operation.action,
		thread: conversationInfo(db, actor, operation.thread),
		...publication,
		to,
		cc,
		notify,
	};
}

function read(
	db: DatabaseSync,
	actor: string,
	operation: Extract<CommunicationOperation, { action: "read" }>,
): CommunicationEffect {
	const page = readConversation(db, actor, {
		thread: operation.thread,
		view: operation.view,
		limit: operation.limit,
		after: operation.after,
		through: operation.through,
		cursor: operation.cursor,
	});
	if (page.view === "catch_up") {
		const through = page.messages.at(-1)?.seq ?? page.last_confirmed_cursor;
		try {
			markRead(db, operation.thread, actor, through);
			page.last_confirmed_cursor = conversationInfo(db, actor, operation.thread).read_up_to;
			if (page.last_confirmed_cursor < through) throw new Error("The read acknowledgment was not recorded.");
			page.acknowledgment = "applied";
			page.acknowledged_through = through;
		} catch (error) {
			page.acknowledgment = "failed";
			page.acknowledgment_reason = error instanceof Error ? error.message : String(error);
		}
	}
	return { action: "read", thread: conversationInfo(db, actor, operation.thread), page };
}

export function applyCommunication(
	db: DatabaseSync,
	actor: string,
	operation: CommunicationOperation,
	now: number,
	id: string,
	publish: PublishCommunication,
): CommunicationEffect {
	if (
		actor !== OPERATOR &&
		(!db.prepare("select 1 from sessions where id = ? and retired_at is null").get(actor) || departureOf(db, actor))
	)
		throw new Error("Communication needs a current person.");
	if (operation.action === "create_channel") return createChannel(db, actor, operation, now, id);
	if (operation.action === "post") return publishPost(db, actor, operation, now, publish);
	if (operation.action === "read") return read(db, actor, operation);
	const info = requireConversationAccess(db, actor, operation.thread);
	switch (operation.action) {
		case "join":
			if (!info.permissions.join) throw new Error("Only accessible channels can be followed.");
			participateIn(db, info.id, actor, now, "pull");
			db.prepare("update thread_participants set following = 1 where thread_id = ? and participant = ?").run(
				info.id,
				actor,
			);
			break;
		case "leave":
			if (info.kind === "task") throw new Error("Task audience changes belong to work assignment.");
			if (info.kind === "channel")
				db.prepare("update thread_participants set following = 0 where thread_id = ? and participant = ?").run(
					info.id,
					actor,
				);
			else participateIn(db, info.id, actor, now, null);
			break;
		case "invite":
			return { action: operation.action, thread: info, people: invite(db, actor, info.id, operation.people, now) };
		case "remove":
			return {
				action: operation.action,
				thread: info,
				people: removeInvitations(db, actor, info.id, operation.people, now),
			};
		case "pin":
			if (!info.permissions.pin) throw new Error("Pinning requires current membership or channel following.");
			messageReference(db, info.id, operation.seq);
			db.prepare("update threads set pinned_seq = ? where id = ?").run(operation.seq, info.id);
			return { action: "pin", thread: conversationInfo(db, actor, info.id), old_pin: info.pinned };
		case "archive":
		case "reopen": {
			if (!(operation.action === "archive" ? info.permissions.archive : info.permissions.reopen))
				throw new Error(
					"This lifecycle action needs ordinary conversation membership or topic following; task and structural channel lifecycle remains owned elsewhere.",
				);
			const body = nonempty(operation.body, operation.action === "archive" ? "Archive summary" : "Reopen reason");
			people(db, operation.notify ?? []);
			if (operation.action === "reopen") db.prepare("update threads set closed_at = null where id = ?").run(info.id);
			if (actor === OPERATOR) participateIn(db, info.id, actor, now, "pull", false);
			const publication = publish({ thread: info.id, body, notify: operation.notify });
			if (operation.action === "archive") db.prepare("update threads set closed_at = ? where id = ?").run(now, info.id);
			return {
				action: operation.action,
				thread: conversationInfo(db, actor, info.id),
				...publication,
				notify: operation.notify ?? [],
			};
		}
		default:
			throw new Error("Unknown communication action.");
	}
	return { action: operation.action, thread: conversationInfo(db, actor, info.id) };
}
