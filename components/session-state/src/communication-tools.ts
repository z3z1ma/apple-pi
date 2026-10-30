import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type Static, type TObject, type TProperties, Type } from "typebox";
import { managerAddress, resolveAddresses } from "./addresses.js";
import { sendCommand } from "./client.js";
import {
	type CommunicationOperation,
	communicationAttempt,
	communicationAttemptId,
	communicationAvailable,
	conversationInbox,
	findChannels,
	searchMessages,
} from "./communication.js";
import { withThreads } from "./threads.js";

export const COMMUNICATION_TOOLS = [
	"send_mail",
	"reply",
	"inbox",
	"read_thread",
	"post",
	"escalate",
	"create_channel",
	"find_channels",
	"join_channel",
	"leave_thread",
	"invite_to_thread",
	"remove_thread_invitation",
	"search_messages",
	"pin_message",
	"archive_thread",
	"reopen_thread",
	"communication_status",
] as const;

const SEND_SCRIPT = fileURLToPath(new URL("../scripts/pi-send.mjs", import.meta.url));
const text = (description: string) => Type.String({ minLength: 1, description });
const addresses = (description: string) =>
	Type.Array(text("A name in your organization, a known session ID, operator, my-team or my-manager."), {
		description,
	});
const limit = Type.Integer({
	minimum: 1,
	maximum: Number.MAX_SAFE_INTEGER,
	description: "Requested page size; no implicit history budget.",
});
const seq = Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER });
const thread = text("The returned conversation ID; an ID alone grants no access.");
const cursor = Type.Optional(text("Opaque continuation from this query; preserves its original filters/view."));
const notify = Type.Optional(
	addresses("Explicit attention recipients who already have access. Names in prose do not notify. Channel-only."),
);

function database<T>(read: Parameters<typeof withThreads<T>>[0]): T {
	const value = withThreads((db) => {
		if (!communicationAvailable(db))
			throw new Error(
				"Communication version 1 is unavailable. Ask the operator to update the runtime before using these tools.",
			);
		return read(db);
	});
	if (value === undefined)
		throw new Error("The communication store is unavailable; the outcome lookup could not be completed.");
	return value;
}

function result(details: unknown) {
	return { content: [{ type: "text" as const, text: JSON.stringify(details, null, 2) }], details };
}

/** Schemas and selection guidance stay at the SDK boundary; shared queries and mutations belong to communication.ts. */
export function installCommunicationTools(pi: ExtensionAPI): void {
	function action<P extends TProperties>(
		name: string,
		description: string,
		promptSnippet: string,
		properties: P,
		build: (self: string, params: Static<TObject<P>>) => CommunicationOperation,
	) {
		pi.registerTool(
			defineTool({
				name,
				label: name,
				description,
				promptSnippet,
				promptGuidelines:
					name === "send_mail"
						? [
								"Answer incoming mail with reply on its thread so current members hear the answer.",
								`Processes outside a session send with: node ${SEND_SCRIPT} <session-id> [--from <name>] <message>`,
							]
						: undefined,
				parameters: Type.Object(properties, { additionalProperties: false }),
				async execute(toolCallId, params, signal, _onUpdate, ctx) {
					return executeAction(name, params, toolCallId, ctx.sessionManager.getSessionId(), signal, () =>
						build(ctx.sessionManager.getSessionId(), params),
					);
				},
			}),
		);
	}
	function query<P extends TProperties>(
		name: string,
		description: string,
		promptSnippet: string,
		properties: P,
		read: (self: string, params: Static<TObject<P>>) => unknown,
	) {
		pi.registerTool(
			defineTool({
				name,
				label: name,
				description,
				promptSnippet,
				parameters: Type.Object(properties, { additionalProperties: false }),
				async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
					return result(read(ctx.sessionManager.getSessionId(), params));
				},
			}),
		);
	}

	action(
		"send_mail",
		"Start an addressed conversation with one or more people; use reply to continue one. Mail pushes each new message to its current members. At-home recipients' mail waits for reopening. Names resolve in your organization; known foreign IDs work. Mail to operator waits in their inbox; ask_user_question interrupts now.",
		"Start a new addressed conversation.",
		{
			to: addresses("People to address."),
			cc: Type.Optional(addresses("Copies become members and receive future replies.")),
			subject: text("What this conversation is about."),
			body: text("The message."),
		},
		(self, params) => {
			const to = resolveAddresses(self, params.to);
			if (!to.length) throw new Error("Nobody to write to; name at least one other person.");
			return {
				action: "post",
				thread: `t-${randomUUID()}`,
				subject: params.subject,
				body: params.body,
				to,
				cc: resolveAddresses(self, params.cc ?? []).filter((id) => !to.includes(id)),
			};
		},
	);
	action(
		"reply",
		"Continue an existing conversation in place. Mail and task replies push to current members. Channel replies stay pulled unless notify explicitly requests selected people's attention; names in prose are just text. Use send_mail for a new exchange, or post for shared channel context.",
		"Continue an existing conversation in place.",
		{ thread, body: text("The reply."), notify },
		(self, params) => ({
			action: "post",
			thread: params.thread,
			body: params.body,
			notify: resolveAddresses(self, params.notify ?? []),
		}),
	);
	action(
		"post",
		"Publish shared context in a channel you can access. Posts wait for catch-up; only notify requests selected people's attention. Names in prose are just text. Posting leaves following and unread history unchanged. Use invite_to_thread to grant an absent colleague access before notifying them.",
		"Publish shared channel context; notify explicitly requests attention.",
		{
			channel: text("An accessible topic, team or organization channel ID."),
			body: text("The shared context."),
			notify,
		},
		(self, params) => ({
			action: "post",
			thread: params.channel,
			threadKind: "channel",
			body: params.body,
			notify: resolveAddresses(self, params.notify ?? []),
		}),
	);
	action(
		"escalate",
		"Raise a decision, risk or blocker beyond your authority with your manager; at an organization root it goes to the operator's inbox. State what needs a decision, the evidence and your recommendation. This is mail, so continue unaffected work. Use ask_user_question for an immediate operator interruption.",
		"Raise a decision, risk or blocker beyond your authority.",
		{ body: text("The decision needed, evidence and recommendation.") },
		(self, params) => ({
			action: "post",
			thread: `t-${randomUUID()}`,
			threadKind: "escalation",
			subject: "Escalation",
			body: params.body,
			to: [managerAddress(self)],
		}),
	);

	query(
		"inbox",
		"List your addressed conversations and followed channels with unread messages. Use all:true for read threads too, and find_channels to discover channels you do not follow. Entries include unread counts, lifecycle and current-context references. This is a preview; read_thread with view:catch_up advances catch-up.",
		"List unread addressed conversations and followed channels.",
		{
			all: Type.Optional(
				Type.Boolean({
					description:
						"Include read and archived conversations too. Unread final messages appear even without this flag.",
				}),
			),
			limit: Type.Optional(limit),
			cursor,
		},
		(self, params) => database((db) => conversationInbox(db, self, params)),
	);
	action(
		"create_channel",
		"Create a topic channel for shared context without changing reporting or assignments. People in its recorded organization scope can discover, read and post. Creation follows it; optional invite records persistent explicit grants and follows it for named colleagues. Creation is quiet and launches nobody. Use group mail for an addressed private exchange.",
		"Open shared topic context without changing reporting.",
		{
			name: text("Channel label; use find_channels to check existing context first."),
			purpose: text("What belongs in this shared context."),
			invite: Type.Optional(
				addresses("People to invite to retained history; grants persist across later scope changes."),
			),
		},
		(self, params) => ({
			action: "create_channel",
			name: params.name,
			purpose: params.purpose,
			invite: resolveAddresses(self, params.invite ?? []),
		}),
	);
	query(
		"find_channels",
		"Discover channels you can access by name or purpose, including ones you do not follow. Results show recorded scope, following, archive state and the pinned current-context reference. Discovery neither follows nor reads history. Use inbox for your unread conversations and directory to find people.",
		"Discover accessible channels by name or purpose.",
		{
			query: Type.Optional(text("Plain case-insensitive name/purpose text.")),
			followed: Type.Optional(Type.Boolean()),
			archived: Type.Optional(
				Type.Union([Type.Literal("exclude"), Type.Literal("include"), Type.Literal("only")], {
					description: "Defaults to exclude; archived channels remain accessible and joinable.",
				}),
			),
			limit,
			cursor,
		},
		(self, params) => database((db) => findChannels(db, self, params)),
	);
	action(
		"join_channel",
		"Follow an accessible channel so activity appears in catch-up lists. Joining neither requests attention nor acknowledges history, starts a process or accepts work. It creates no access grant. Use invite_to_thread when someone needs access; a channel ID alone is not an invitation.",
		"Follow an accessible channel for catch-up.",
		{ channel: text("An accessible channel ID, including an archived channel.") },
		(_self, params) => ({ action: "join", thread: params.channel }),
	);
	action(
		"leave_thread",
		"Leave an addressed conversation, or stop following a channel. For mail, leaving removes membership and future replies. For a channel, it only removes it from catch-up lists: access and explicit notifications remain possible. Neither changes assignments or reporting. Use remove_thread_invitation to remove an explicit grant; task audiences stay work-owned.",
		"Leave private membership, or stop following a channel.",
		{ thread },
		(_self, params) => ({ action: "leave", thread: params.thread }),
	);
	action(
		"invite_to_thread",
		"Invite people into retained conversation history. In mail they become members and receive future replies. In a channel an explicit grant persists across scope changes, even if access already exists, and follows it for them. Invitations are quiet and change neither staffing nor assignments. Known foreign IDs work; task audiences stay work-owned.",
		"Admit people to retained context; report actual grants and following.",
		{ thread, people: addresses("People to invite; this exposes retained history, not just future posts.") },
		(self, params) => ({ action: "invite", thread: params.thread, people: resolveAddresses(self, params.people) }),
	);
	action(
		"remove_thread_invitation",
		"Remove explicit channel invitations or addressed-conversation members. Organization-derived access remains; results report effective access and following separately. This is not an unfollow action or a reporting change. Use leave_thread for your own departure; task audiences stay work-owned. Previously addressed messages cannot be recalled.",
		"Remove explicit grants; report remaining access and following.",
		{ thread, people: addresses("People whose explicit invitation or private membership should be removed.") },
		(self, params) => ({ action: "remove", thread: params.thread, people: resolveAddresses(self, params.people) }),
	);

	action(
		"read_thread",
		"Read an accessible conversation in ordered pages. view:catch_up reads from your unread position and acknowledges only the returned page. recent and range inspect without advancing catch-up; search_messages finds evidence across conversations. Results include stable references, current-context pin and acknowledgment status. Choose the page size with limit.",
		"Read ordered pages; catch_up alone advances channel catch-up.",
		{
			thread,
			view: Type.Optional(
				Type.Union([Type.Literal("catch_up"), Type.Literal("recent"), Type.Literal("range")], {
					description: "Defaults to catch_up. recent/range inspect without acknowledgment.",
				}),
			),
			limit,
			after: Type.Optional(
				Type.Integer({
					minimum: 0,
					maximum: Number.MAX_SAFE_INTEGER,
					description: "Exclusive lower sequence bound; range only.",
				}),
			),
			through: Type.Optional(
				Type.Integer({
					minimum: 0,
					maximum: Number.MAX_SAFE_INTEGER,
					description: "Inclusive upper sequence bound; range only.",
				}),
			),
			cursor,
		},
		(_self, params) => ({ action: "read", ...params }),
	);
	query(
		"search_messages",
		"Find evidence in shared message bodies you can currently access, including archived conversations. Results cite thread/message sequences for selective reading. Search neither follows nor advances catch-up. Use find_channels for names/purposes, or search_session for your own transcript.",
		"Find evidence in authorized shared message bodies.",
		{
			query: text("Plain case-insensitive message text, not a query language."),
			thread: Type.Optional(thread),
			limit,
			cursor,
		},
		(self, params) => database((db) => searchMessages(db, self, params)),
	);
	action(
		"pin_message",
		"Point current context at one existing message, replacing the previous pin while preserving messages and authors. Use an authored brief, decision or link to the authoritative task/wiki. A pin is not an automatic summary, task goal or proof of consensus. Authorized participants may repin archived conversations; this sends no attention.",
		"Point current context to one existing authored message.",
		{ thread, seq },
		(_self, params) => ({ action: "pin", thread: params.thread, seq: params.seq }),
	);
	action(
		"archive_thread",
		"Publish a conclusion and archive ordinary discussion together. Any mail member or joined topic participant may do this. Mail pushes; a channel stays quiet unless notify requests accessible recipients' attention. Archive preserves evidence and unread final messages, not consensus or finished work. Structural/task lifecycle stays with its owner; reopen_thread resumes discussion.",
		"Record a conclusion and reversibly archive ordinary discussion.",
		{ thread, summary: text("The attributed conclusion, evidence and remaining work."), notify },
		(self, params) => ({
			action: "archive",
			thread: params.thread,
			body: params.summary,
			notify: resolveAddresses(self, params.notify ?? []),
		}),
	);
	action(
		"reopen_thread",
		"Reopen archived ordinary discussion and record why. Any mail member or joined topic participant may do this; it restores discussion, not actors or assignments. The reason uses normal delivery: mail pushes, channels notify only explicit accessible recipients. Historical meeting kinds remain unchanged; structural/task lifecycle stays with its owner.",
		"Resume archived ordinary discussion with an attributed reason.",
		{ thread, reason: text("Why this discussion should resume."), notify },
		(self, params) => ({
			action: "reopen",
			thread: params.thread,
			body: params.reason,
			notify: resolveAddresses(self, params.notify ?? []),
		}),
	);
	query(
		"communication_status",
		"Look up one prior communication action using its attempt handle or original SDK tool-call ID. It returns the original resolved audience and known effect; it neither sends again nor proves anyone understood or acted. Use after an uncertain result, inbox for unread conversations, and directory for availability. A missing record cannot reconstruct the original intent.",
		"Inspect one prior action's outcome, not traffic or understanding.",
		{ attempt: text("Returned attempt handle or original SDK tool-call ID; a new send is a new attempt.") },
		(self, params) =>
			database((db) => {
				const direct = communicationAttempt(db, self, params.attempt);
				if (direct.outcome !== "not_recorded") return direct;
				const original = communicationAttempt(db, self, communicationAttemptId(self, params.attempt));
				return original.outcome === "not_recorded" ? direct : original;
			}),
	);
}

async function executeAction(
	tool: string,
	args: unknown,
	toolCallId: string,
	self: string,
	signal: AbortSignal | undefined,
	build: () => CommunicationOperation,
) {
	const attempt = communicationAttemptId(self, toolCallId);
	const input = { tool, arguments: args };
	const previous = database((db) => communicationAttempt(db, self, attempt, input));
	if (previous.outcome === "applied" || previous.outcome === "refused") {
		return { ...result(previous), isError: previous.outcome === "refused" };
	}
	let operation: CommunicationOperation;
	try {
		operation = previous.command?.operation ?? build();
	} catch (error) {
		return { ...result({ attempt, outcome: "refused", recorded: false, reason: String(error) }), isError: true };
	}
	try {
		await sendCommand(self, previous.command ?? { kind: "communication", version: 1, input, operation }, {
			commandId: attempt,
			signal,
		});
		const settled = database((db) => communicationAttempt(db, self, attempt, input));
		return { ...result(settled), isError: settled.outcome === "refused" };
	} catch (error) {
		return {
			...result({
				attempt,
				outcome: "uncertain",
				reason: String(error),
				recovery:
					"Use communication_status with this attempt. A new sending call is a new attempt and may duplicate the effect.",
			}),
			isError: true,
		};
	}
}
