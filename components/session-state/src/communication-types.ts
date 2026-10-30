import type { ThreadKind } from "./threads.js";

export interface CommunicationInput {
	tool: string;
	arguments: unknown;
}

export type CommunicationOperation =
	| {
			action: "post";
			thread: string;
			body: string;
			subject?: string;
			threadKind?: ThreadKind;
			to?: string[];
			cc?: string[];
			notify?: string[];
	  }
	| { action: "create_channel"; name: string; purpose: string; invite: string[]; scopeHead?: string }
	| { action: "join" | "leave"; thread: string }
	| { action: "invite" | "remove"; thread: string; people: string[] }
	| { action: "pin"; thread: string; seq: number }
	| { action: "archive" | "reopen"; thread: string; body: string; notify?: string[] }
	| ({ action: "read" } & ConversationReadOptions);

export interface CommunicationCommand {
	kind: "communication";
	version: 1;
	input: CommunicationInput;
	operation: CommunicationOperation;
}

export interface MessageReference {
	thread: string;
	seq: number;
	id: string;
}

export interface ConversationMessage {
	thread: string;
	seq: number;
	id: string;
	from: string;
	fromName: string;
	body: string;
	at: number;
	reference: MessageReference;
}

export interface ConversationParticipant {
	id: string;
	name: string;
	access_sources: string[];
	following: boolean | null;
}

export interface ConversationInfo {
	id: string;
	kind: ThreadKind;
	channel_type: "topic" | "team" | "organization" | null;
	name: string;
	purpose: string | null;
	scope_head: string | null;
	archived: boolean;
	pinned: MessageReference | null;
	access: boolean;
	access_sources: string[];
	following: boolean | null;
	read_up_to: number;
	unread: number;
	participants: ConversationParticipant[];
	invitations?: ConversationParticipant[];
	permissions: {
		post: boolean;
		join: boolean;
		invite: boolean;
		remove: boolean;
		pin: boolean;
		archive: boolean;
		reopen: boolean;
	};
}

export interface ConversationReadOptions {
	thread: string;
	view?: "catch_up" | "recent" | "range";
	limit: number;
	after?: number;
	through?: number;
	cursor?: string;
}

export interface ConversationPage {
	thread: ConversationInfo;
	view: "catch_up" | "recent" | "range";
	messages: ConversationMessage[];
	next_cursor?: string;
	window_through: number;
	acknowledgment: "not_requested" | "applied" | "failed" | "uncertain";
	acknowledgment_reason?: string;
	acknowledged_through: number | null;
	last_confirmed_cursor: number;
}

export interface ChannelFindOptions {
	query?: string;
	followed?: boolean;
	archived?: "exclude" | "include" | "only";
	scopeHead?: string;
	limit: number;
	cursor?: string;
}

export interface ConversationInboxOptions {
	all?: boolean;
	limit?: number;
	cursor?: string;
}

export interface MessageSearchOptions {
	query: string;
	thread?: string;
	limit: number;
	cursor?: string;
}

export interface ConversationList {
	threads: ConversationInfo[];
	next_cursor?: string;
}

export interface MessageSearchResult {
	messages: ConversationMessage[];
	next_cursor?: string;
}

export interface InvitationEffect {
	person: string;
	explicit_invitation_added?: boolean;
	explicit_invitation_removed?: boolean;
	membership_added?: boolean;
	membership_removed?: boolean;
	access: boolean;
	access_sources: string[];
	following: boolean | null;
}

export interface CommunicationEffect {
	action: CommunicationOperation["action"];
	thread: ConversationInfo;
	message?: ConversationMessage;
	page?: ConversationPage;
	people?: InvitationEffect[];
	to?: string[];
	cc?: string[];
	notify?: string[];
	audience?: string[];
	queued?: string[];
	old_pin?: MessageReference | null;
}

export interface CommunicationAttempt {
	attempt: string;
	outcome: "not_recorded" | "pending" | "applied" | "refused";
	stage?: "accepted" | "delivered" | "applied" | "failed";
	reason?: string;
	command?: CommunicationCommand;
	effect?: CommunicationEffect;
}
