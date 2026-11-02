import type {
	ChannelFindOptions,
	CommunicationAttempt,
	ConversationList,
	ConversationPage,
	ConversationReadOptions,
	MessageSearchOptions,
	MessageSearchResult,
} from "../../../components/session-state/src/communication-types.js";

export type {
	ConversationInfo,
	ConversationList,
	ConversationMessage,
	ConversationPage,
	MessageSearchResult,
} from "../../../components/session-state/src/communication-types.js";

export type CommunicationResult = CommunicationAttempt | { attempt: string; outcome: "uncertain"; reason: string };

export type CommunicationQuery<T> = { ok: true; value: T } | { ok: false; reason: string };

export type CommunicationRead =
	| { ok: true; page: ConversationPage; attempt?: string }
	| { ok: false; reason: string; attempt?: string };

export interface CommunicationAction {
	attempt: string;
	thread: string;
}

export interface CommunicationPost extends CommunicationAction {
	body: string;
	notify?: string[];
}

export interface CommunicationsApi {
	sendMail(request: {
		attempt: string;
		to: string[];
		cc?: string[];
		subject: string;
		body: string;
	}): Promise<CommunicationResult>;
	findChannels(options: ChannelFindOptions): Promise<CommunicationQuery<ConversationList>>;
	createChannel(request: {
		attempt: string;
		scopeHead: string;
		name: string;
		purpose: string;
		invite?: string[];
	}): Promise<CommunicationResult>;
	/** Catch-up needs a stable UI attempt; recent/range inspections remain query-only. */
	readThread(request: ConversationReadOptions & { attempt?: string }): Promise<CommunicationRead>;
	searchMessages(options: MessageSearchOptions): Promise<CommunicationQuery<MessageSearchResult>>;
	post(request: CommunicationPost): Promise<CommunicationResult>;
	join(request: CommunicationAction): Promise<CommunicationResult>;
	leave(request: CommunicationAction): Promise<CommunicationResult>;
	invite(request: CommunicationAction & { people: string[] }): Promise<CommunicationResult>;
	removeInvitations(request: CommunicationAction & { people: string[] }): Promise<CommunicationResult>;
	pin(request: CommunicationAction & { seq: number }): Promise<CommunicationResult>;
	archive(request: CommunicationAction & { summary: string; notify?: string[] }): Promise<CommunicationResult>;
	reopen(request: CommunicationAction & { reason: string; notify?: string[] }): Promise<CommunicationResult>;
	status(request: { attempt: string }): Promise<CommunicationResult>;
}
