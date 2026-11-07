import type { CallInRequest, CallInResult } from "./call-in.js";
import type { CommunicationsApi } from "./communications.js";
import type { RetirePeopleProgress, RetirePeopleRequest } from "./departures.js";
import type { IntegrationsApi } from "./integrations.js";

export type { CallInPerson, CallInRequest, CallInResult } from "./call-in.js";

import type { GitApi } from "./git.js";
import type { KnowledgeApi } from "./knowledge.js";
import type { OrgMoveRequest, OrgMoveResult, OrgStartProgress, OrgStartRequest } from "./org.js";
import type { ReviewsApi } from "./reviews.js";
import type { TerminalApi } from "./terminal.js";
import type { WorkspaceApi } from "./workspace.js";

export type {
	OrgMoveRequest,
	OrgMoveResult,
	OrgStartPerson,
	OrgStartPosition,
	OrgStartProgress,
	OrgStartRequest,
} from "./org.js";

export type Role = "coordinator" | "worker" | "independent";

export type PlaceRef =
	| { kind: "headquarters" | "common-room" | "meeting-room" | "gallery"; headquarters: string }
	| { kind: "wing"; headquarters: string; repository: string }
	| { kind: OutsideKind };

export const OUTSIDE_KINDS = ["square", "street", "inn", "rookery", "forge", "quest-office", "library"] as const;
export type OutsideKind = (typeof OUTSIDE_KINDS)[number];

export type RunState = "idle" | "thinking" | "writing_reply" | "running_tool" | "compacting";

export type Status = "asking" | "working" | "idle";

export interface CharacterFacts {
	temporary?: boolean;
	run: RunState;
	status: Status;
	asking: { kind: string; text: string | null; questionnaire?: Questionnaire } | null;
	needsYouSince: number | null;
	unseen: boolean;
	seenAt: number | null;
	settledAt: number | null;
	tool: { name: string; arg: string | null; since: number | null } | null;
	task: { title: string; status: string | null; bundle: string; goalMissing?: boolean } | null;
	git: { repository: string; worktree: string; branch: string } | null;
	cwd: string;
	reportsTo: string | null;
	title?: string | null;
	soul?: string | null;
	selfHeadings?: string[];
	tasks?: string[];
	model: string | null;
	contextTokens: number | null;
	contextWindow: number | null;
	cost: number;
	tmux: { socket: string; pane: string; session: string | null; window: number | null } | null;
}

export type ProfileRead = { ok: true; self: string | null } | { ok: false; reason: string };

export interface Character {
	id: string;
	name: string;
	role: Role;
	place: PlaceRef;
	specialization?: string | null;
	hiredAt?: number | null;
	startedAt: number;
	facts?: CharacterFacts;
}

export interface Wing {
	repository: string;
	team?: string;
	name: string;
	headcount: number;
	dormant?: number;
}

export interface Headquarters {
	id: string;
	name: string;
	wings: Wing[];
}

export interface WorldSnapshot {
	connected: boolean;
	headquarters: Headquarters[];
	characters: Character[];
	avatarLook?: string | null;
	theme?: string | null;
	dormant?: DormantAgent[];
	mail?: MailItem[];
	operatorMail?: MailThreadSummary[];
	workplace?: Workplace;
	desk?: Desk | null;
}

export interface Desk {
	thread: string;
	person: string;
}

export interface WorkplaceThread {
	id: string;
	kind: "channel" | "meeting";
	channelType?: "topic" | "team" | "organization" | null;
	scopeHead?: string | null;
	subject: string;
	createdBy: string;
	headquarters: string;
	closed: boolean;
	lastSeq: number;
	lastAt: number;
	participants: string[];
	purpose?: string | null;
	listener?: string | null;
	charter?: string | null;
}

export interface WorkplaceTask {
	id: string;
	bundle: string;
	project: string;
	headquarters: string;
	title: string;
	status: string | null;
	ephemeral: boolean;
	thread: string | null;
	goalMissing?: boolean;
	assignees: { person: string; focused: boolean }[];
}

export interface WorkplaceTaskParticipation {
	person: string;
	assignedAt: number;
	endedAt: number | null;
	outcome: "held" | "finished" | "unassigned" | "discarded" | "unknown";
	focused: boolean;
}

export interface WorkplaceTaskHistory {
	id: string;
	bundle: string;
	project: string;
	headquarters: string;
	title: string;
	status: string | null;
	thread: string;
	goalMissing?: boolean;
	openedAt: number | null;
	closedAt: number | null;
	updatedAt: number | null;
	participants: WorkplaceTaskParticipation[];
}

export interface Workplace {
	threads: WorkplaceThread[];
	tasks: WorkplaceTask[];
	workHistory?: WorkplaceTaskHistory[];
	escalations: { thread: string; person: string; headquarters: string }[];
	taskActivity?: Record<
		string,
		{ messages: number; lastAt: number; lastFrom: string | null; preview: string | null; unread: number }
	>;
	messageTasks?: Record<string, string>;
}

export type TaskRead = { ok: true; text: string } | { ok: false; reason: string };

export type KeptPart = "dormant" | "mail";

export interface WorldUpdate extends WorldSnapshot {
	unchanged?: KeptPart[];
}

export interface DormantAgent {
	temporary?: boolean;
	id: string;
	name: string;
	role: Role;
	title?: string | null;
	reportsTo: string | null;
	retiredAt?: number | null;
	retiredReason?: string | null;
	repository: string | null;
	cwd: string;
	task: { title: string; status: string | null; bundle: string } | null;
	stoppedAt: number | null;
	stopReason: string | null;
	specialization?: string | null;
	hiredAt?: number | null;
	startedAt: number;
}

export const OPERATOR = "operator";

export interface ThemeChoice {
	id: string;
	name: string;
	description: string | null;
	problems: { file: string; fault: string }[];
}

export interface MailItem {
	id: string;
	from: string;
	fromName: string;
	to: string;
	toName: string;
	body: string;
	sentAt: number;
	deliveredAt: number | null;
	state: "delivered" | "waiting" | "failed";
	reason: string | null;
}

export interface MailThreadSummary {
	id: string;
	subject: string;
	unread: number;
	lastAt: number;
	kind?: string;
	messages?: number;
	lastFrom?: string | null;
	lastFromName?: string;
	preview?: string | null;
	participants?: string[];
}

export interface MailThread {
	readUpTo?: number;
	id: string;
	subject: string;
	closed: boolean;
	participants: { id: string; name: string }[];
	messages: { seq: number; from: string; name: string; body: string; at: number }[];
}

export type ThreadRead = { ok: true; thread: MailThread } | { ok: false; reason: string };

export const MAIL_BODY_MAX = 4000;

export const NAME_MAX = 60;

export type CommandReceipt =
	| { ok: true; stage: "accepted" | "delivered" | "applied"; note?: string }
	| { ok: false; reason: string; confirm?: boolean; dissolve?: true };

export interface RecruitRequest {
	name: string;
	cwd: string;
	brief?: string;
	reportsTo?: string;
	role?: string;
	specialization?: string;
}

export interface RoleChoice {
	name: string;
	title: string;
	mandate: string;
	manages: boolean;
	writes: boolean;
}

export type RecruitReceipt = CommandReceipt & { sessionId?: string };

export function isOutside(place: PlaceRef): place is { kind: OutsideKind } {
	return (OUTSIDE_KINDS as readonly string[]).includes(place.kind);
}

export function placeKey(place: PlaceRef): string {
	if (isOutside(place)) return place.kind;
	if (place.kind === "wing") return `wing:${place.headquarters}:${place.repository}`;
	return `${place.kind}:${place.headquarters}`;
}

export type FeedKind = "agents" | "mail" | "commands";

export interface FeedLine {
	seq: number;
	at: number;
	kind: FeedKind;
	character: string | null;
	name: string | null;
	text: string;
}

export type TerminalResult = { ok: true } | { ok: false; reason: string };

export interface TranscriptToolCall {
	id: string;
	name: string;
	arg: string | null;
	input: string;
}

export type TranscriptPart =
	| { kind: "text"; text: string }
	| { kind: "thinking"; text: string }
	| { kind: "tool"; call: TranscriptToolCall };

export type TranscriptEntry = (
	| { kind: "user"; id: string; at: number; text: string; images: number }
	| { kind: "assistant"; id: string; at: number; parts: TranscriptPart[]; error: string | null; aborted: boolean }
	| {
			kind: "tool-result";
			id: string;
			at: number;
			callId: string;
			tool: string;
			text: string;
			isError: boolean;
			cut: boolean;
	  }
	| { kind: "mail"; id: string; at: number; from: string; text: string }
	| { kind: "note"; id: string; at: number; label: string; text: string; shown: boolean }
) & {
	reactions?: { emoji: string; people: string[] }[];
};

export const TRANSCRIPT_TEXT_MAX = 20_000;

export interface OutsideItem {
	id: string;
	source: OutsideSource;
	kind: string;
	conversation: string;
	title: string;
	actor: string | null;
	url: string | null;
	excerpt: string | null;
	at: number;
	direct: boolean;
	deliveredAt: number | null;
	triage: { by: string; action: string; note: string; ref?: string; at: number } | null;
	rule: { id: string; effect: string; note: string } | null;
}
export interface CanvasSummary {
	id: string;
	title: string;
	preview: string;
	by: string;
	createdAt: number;
	updatedAt: number;
	updatedBy: string;
	version: number;
	pinned: boolean;
}
export type CanvasList = { ok: true; canvases: CanvasSummary[] } | { ok: false; reason: string };
export type CanvasRead = { ok: true; canvas: CanvasSummary & { body: string } } | { ok: false; reason: string };
export type CanvasSaved = { ok: true; id: string; version: number } | { ok: false; reason: string; changed?: boolean };

export interface OrgNote {
	id: string;
	title: string;
	body: string;
	topics: string[];
	refs: string[];
	by: string;
	createdAt: number;
	updatedAt: number;
}
export type NotesRead = { ok: true; notes: OrgNote[] } | { ok: false; reason: string };

export interface OutsideRule {
	id: string;
	match: { source?: OutsideSource; kind?: string; place?: string; actor?: string; words?: string };
	effect: "hide" | "quiet" | "triage" | "route";
	person: string | null;
	note: string;
	by: string;
	createdAt: number;
}
export type OutsideSource = "github" | "jira" | "slack" | "calendar" | "gmail";
export const OUTSIDE_SOURCES: readonly OutsideSource[] = ["slack", "github", "jira", "calendar", "gmail"];
export type OutsideMode = "all" | "direct" | "list" | "off";
export type OutsideRead =
	| {
			ok: true;
			items: OutsideItem[];
			sources: { source: OutsideSource; mode: OutsideMode; polledAt: number | null; error: string | null }[];
			rules: OutsideRule[];
			connections: Record<string, { id: string; title: string }[]>;
	  }
	| { ok: false; reason: string };

export interface ConversationHit {
	session: string;
	entry: string;
	at: number;
	speaker: string;
	text: string;
}
export type ConversationSearch = { ok: true; hits: ConversationHit[] } | { ok: false; reason: string };

export type ConversationPage =
	| { ok: true; entries: TranscriptEntry[]; before: string | null; missing: number }
	| { ok: false; reason: string };

export type CommandResult = { ok: true } | { ok: false; reason: string };

export type ReceiptStage = "accepted" | "delivered" | "applied" | "failed";

export interface Receipt {
	commandId: string;
	characterId: string;
	stage: ReceiptStage;
	reason?: string;
}

export interface Question {
	question: string;
	header: string | null;
	options: { label: string; description: string }[];
	multiSelect: boolean;
}

export interface Questionnaire {
	id: string;
	questions: Question[];
}

export type QuestionnaireReply = { selected: string[] } | { custom: string };

export type Instruction =
	| { kind: "talk" | "steer" | "follow_up"; text: string }
	| { kind: "abort"; confirmed?: boolean }
	| { kind: "answer"; questionnaire: string; replies: QuestionnaireReply[] }
	| { kind: "withdraw"; command: string };

export type ReplyStreamEvent =
	| { kind: "delta"; characterId: string; streamId: string; seq: number; delta: string }
	| { kind: "end"; characterId: string; streamId: string; entry: TranscriptEntry | null };

export type NotepadRead = { ok: true; path: string; text: string } | { ok: false; reason: string };
export type NotepadSave = { ok: true } | { ok: false; reason: string; changed?: string };
export interface NotepadChange {
	coordinatorId: string;
	text: string;
}

export interface AgentWorkplaceApi extends IntegrationsApi {
	communications: CommunicationsApi;
	reviews: ReviewsApi;
	workspace: WorkspaceApi;
	knowledge: KnowledgeApi;
	git: GitApi;
	terminal: TerminalApi;
	snapshot(): Promise<WorldSnapshot>;
	onUpdate(listener: (update: WorldUpdate) => void): () => void;
	feed(): Promise<FeedLine[]>;
	onFeed(listener: (lines: FeedLine[]) => void): () => void;
	goToTerminal(characterId: string): Promise<TerminalResult>;
	profile(characterId: string): Promise<ProfileRead>;
	conversation(characterId: string, before?: string, textOnly?: boolean): Promise<ConversationPage>;
	searchConversations(query: string): Promise<ConversationSearch>;
	markSeen(characterId: string): Promise<CommandResult>;
	setAvatarLook(look: string): Promise<CommandResult>;
	themes(): Promise<ThemeChoice[]>;
	setTheme(id: string): Promise<CommandResult>;
	setDesk?(desk: Desk): Promise<CommandResult>;
	instruct(characterId: string, commandId: string, instruction: Instruction): Promise<CommandResult>;
	onReceipt(listener: (receipt: Receipt) => void): () => void;
	watchReplies(characterIds: string[]): Promise<void>;
	onReply(listener: (event: ReplyStreamEvent) => void): () => void;
	wake(characterId: string): Promise<CommandReceipt>;
	callIn(request: CallInRequest): Promise<CallInResult>;
	endSession(characterId: string, confirmed?: boolean, dissolve?: boolean): Promise<CommandReceipt>;
	sendMail(characterId: string, body: string): Promise<CommandReceipt>;
	readThread(thread: string): Promise<ThreadRead>;
	replyThread(thread: string, body: string): Promise<CommandReceipt>;
	readTask(task: string): Promise<TaskRead>;
	assignTask(person: string, task: string): Promise<CommandReceipt>;
	unassignTask(person: string, task: string): Promise<CommandReceipt>;
	closeTask(task: string, status: "done" | "cancelled"): Promise<CommandReceipt>;
	readOutside(request: { source?: OutsideSource; untriaged?: boolean; limit: number }): Promise<OutsideRead>;
	setOutsideModes(modes: Partial<Record<OutsideSource, OutsideMode>>): Promise<CommandReceipt>;
	listCanvases(request: { words?: string; limit: number }): Promise<CanvasList>;
	readCanvas(id: string): Promise<CanvasRead>;
	writeCanvas(
		write:
			| { create: { title: string; body?: string } }
			| { update: string; base: number; title?: string; body?: string; pinned?: boolean }
			| { remove: string },
	): Promise<CanvasSaved>;
	readNotes(request: { words?: string; limit: number }): Promise<NotesRead>;
	setOutsideRule(
		request:
			| { remove: string }
			| { match: OutsideRule["match"]; effect: OutsideRule["effect"]; person?: string; note: string },
	): Promise<CommandReceipt>;
	readWorkplaceThread(thread: string): Promise<ThreadRead>;
	setChannelMembership(thread: string, joined: boolean): Promise<CommandReceipt>;
	recruit(request: RecruitRequest): Promise<RecruitReceipt>;
	rename(characterId: string, name: string): Promise<CommandReceipt>;
	roles(): Promise<RoleChoice[]>;
	organizationLifetime(
		root: string,
	): Promise<import("../../../components/session-state/src/organization-lifetime.js").OrganizationLifetime>;
	incorporateOrganization(root: string): Promise<CommandResult>;
	orgMove(request: OrgMoveRequest): Promise<OrgMoveResult>;
	orgStart(request: OrgStartRequest): Promise<OrgStartProgress>;
	onOrgStart(listener: (progress: OrgStartProgress) => void): () => void;
	retirePeople(request: RetirePeopleRequest): Promise<RetirePeopleProgress>;
	onRetirePeople(listener: (progress: RetirePeopleProgress) => void): () => void;
	retire(characterId: string, reason: string, handoff?: boolean): Promise<CommandReceipt>;
	openNotepad(coordinatorId: string): Promise<NotepadRead>;
	saveNotepad(coordinatorId: string, text: string, base: string): Promise<NotepadSave>;
	closeNotepad(): Promise<void>;
	onNotepad(listener: (change: NotepadChange) => void): () => void;
	openFile(href: string, base: string): Promise<CommandResult>;
	openLink(url: string): Promise<CommandResult>;
	codeAuthor(path: string): Promise<CodeAuthor | null>;
	browserPage(characterId: string, callId: string): Promise<{ tool: string; url: string } | null>;
}

export interface CodeAuthor {
	id: string;
	name: string;
	editedAt: number;
}
