// The world as the backend reports it to the world UI. Shared by the backend, the preload bridge, and the renderer.
import type { IntegrationsApi } from "./integrations.js";
import type { OrgMoveRequest, OrgMoveResult, OrgStartProgress, OrgStartRequest } from "./org.js";
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

/**
 * How a character is drawn: a coordinator is the root of an organization (it keeps the headquarters) or a manager
 * inside one; a worker reports to one; an independent session reports to none and has nobody under it
 * (`.wiki/pages/agent-world-language.md`). The role a person holds for life is its `facts.title`.
 */
export type Role = "coordinator" | "worker" | "independent";

/** Where an awake character is. Headquarters, and the places inside them, are keyed by their coordinator's id. */
export type PlaceRef =
	| { kind: "headquarters" | "common-room" | "meeting-room" | "gallery"; headquarters: string }
	| { kind: "wing"; headquarters: string; repository: string }
	/**
	 * Outside: the village square, the inn where dormant agents sleep, the rookery where mail comes and goes, and the
	 * function places off the square (the forge for GitHub, the quest office for Jira, the library for Confluence), and the
	 * street beyond the square (the second exterior, ticket 09 of the alive pass), where townsfolk the square has no room
	 * for stand.
	 */
	| { kind: OutsideKind };

/** The places outside any headquarters. */
export const OUTSIDE_KINDS = ["square", "street", "inn", "rookery", "forge", "quest-office", "library"] as const;
export type OutsideKind = (typeof OUTSIDE_KINDS)[number];

/** A session's run state as the runtime records it. */
export type RunState = "idle" | "thinking" | "writing_reply" | "running_tool" | "compacting";

/** What the sidebar shows: asking (an open prompt), working (any run state but idle), or idle. */
export type Status = "asking" | "working" | "idle";

/** Observed facts about a character, as the session-state runtime records them (`docs/session-state.md`). */
export interface CharacterFacts {
	/** A known temporary program peer; World retains it, Org excludes it. */
	temporary?: boolean;
	run: RunState;
	status: Status;
	/**
	 * The open prompt: its kind, and its title or first question. An `ask_user_question` questionnaire also carries its
	 * id and questions, so the conversation panel can answer it; any other dialog is answered only in the terminal.
	 */
	asking: { kind: string; text: string | null; questionnaire?: Questionnaire } | null;
	/** Since when it has needed the operator (an open prompt, or a settle not seen yet); null when it does not. */
	needsYouSince: number | null;
	/**
	 * A settled run the operator has not seen, with no prompt open. It stays set while a later run works; the views
	 * show that run first and mark the unseen result beside it.
	 */
	unseen: boolean;
	seenAt: number | null;
	settledAt: number | null;
	/** The top-level tool running now, with its main argument (command, path, ...). */
	tool: { name: string; arg: string | null; since: number | null } | null;
	/** Its explicitly focused task: the title and status from task.md, whether ledger or ephemeral. */
	task: { title: string; status: string | null; bundle: string; goalMissing?: boolean } | null;
	git: { repository: string; worktree: string; branch: string } | null;
	cwd: string;
	reportsTo: string | null;
	/**
	 * The person (the backend always sets these; fixtures may leave them out): the title of the role it was hired into
	 * (null for a session with no role, such as the operator's own), one line of the soul drawn at hire, the headings of
	 * its self (the document it keeps about itself and its teammates), and the tasks it has finished, newest first.
	 */
	title?: string | null;
	soul?: string | null;
	selfHeadings?: string[];
	tasks?: string[];
	model: string | null;
	contextTokens: number | null;
	contextWindow: number | null;
	cost: number;
	/** Its tmux pane, with the tmux session and window that show it when the runtime has seen them. */
	tmux: { socket: string; pane: string; session: string | null; window: number | null } | null;
}

export type ProfileRead = { ok: true; self: string | null } | { ok: false; reason: string };

/** One awake top-level Pi session. */
export interface Character {
	id: string;
	name: string;
	role: Role;
	place: PlaceRef;
	/** Creator-set attention within the role; absent on older snapshots. */
	specialization?: string | null;
	/** When the session was explicitly hired (ms); absent for older or non-hired people. */
	hiredAt?: number | null;
	/** Earliest runtime-observed incarnation (ms), not a hire date; also owns the stable roster order. */
	startedAt: number;
	/** Always set by the backend; fixtures that test only places may leave it out. */
	facts?: CharacterFacts;
}

/**
 * One room off the headquarters: a repository's wing, which stays once seen and is boarded up while nobody works in
 * it, or a manager's team room (`team` set), which exists while the manager is in the organization.
 */
export interface Wing {
	/** The repository's directory (the main checkout, shared by its worktrees), or `team:<manager id>` for a team room. */
	repository: string;
	/** For a team room: the manager whose team it is. */
	team?: string;
	/** What its banner says. */
	name: string;
	/** Awake workers in it; 0 means its door is shut. */
	headcount: number;
	/**
	 * Its workers whose sessions are stopped (dormant, at the inn). With nobody awake, its door is closed while it has
	 * some and boarded up while it has none.
	 */
	dormant?: number;
}

/** A coordinator's headquarters: its hall, common room, and gallery of wings. */
export interface Headquarters {
	/** The coordinator's session id. */
	id: string;
	name: string;
	/** In the order they were first seen. */
	wings: Wing[];
}

export interface WorldSnapshot {
	/** False while the session-state runtime or its database is gone; everything else is then the last known state. */
	connected: boolean;
	/** In a stable order: the first is where the world opens. */
	headquarters: Headquarters[];
	characters: Character[];
	/** The avatar look the operator chose in Settings; null (or absent) until he chooses one. */
	avatarLook?: string | null;
	/** The theme the operator chose in Settings; null (or absent) until he chooses one. */
	theme?: string | null;
	/** Every stopped top-level session, asleep at the inn: the most recently stopped first. */
	dormant?: DormantAgent[];
	/** Recent mail between sessions (and from the operator), newest first, with every mail still waiting. */
	mail?: MailItem[];
	/** The operator's threaded inbox. Unread threads need the operator, independently of session attention. */
	operatorMail?: MailThreadSummary[];
	/** Open meetings, team channels, live work, and read-only ledger discovery. Mail stays in the inbox/traffic views. */
	workplace?: Workplace;
}

export interface WorkplaceThread {
	id: string;
	kind: "channel" | "meeting";
	subject: string;
	createdBy: string;
	headquarters: string;
	closed: boolean;
	lastSeq: number;
	lastAt: number;
	participants: string[];
}

export interface WorkplaceTask {
	/** A registered task id, or the absolute bundle path of an unregistered backlog item. */
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
	/** The recorded task organization, not the assignees' current reporting root. */
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
}

export type TaskRead = { ok: true; text: string } | { ok: false; reason: string };

/** The parts of a snapshot an update may leave out while they are the same as in the update before. */
export type KeptPart = "dormant" | "mail";

/**
 * A snapshot as an update carries it: the inn (thousands of sleepers) and the mail change seldom, so an update
 * leaves out each that is the same as in the update before and names it in `unchanged`; the receiver keeps its own.
 */
export interface WorldUpdate extends WorldSnapshot {
	unchanged?: KeptPart[];
}

/** A stopped top-level session (a dormant character): it sleeps at the inn until it is woken. */
export interface DormantAgent {
	temporary?: boolean;
	id: string;
	name: string;
	/** What it was while awake; a dormant coordinator keeps its look. */
	role: Role;
	/** The title of the role it holds, or null without one (the backend always sets it; fixtures may leave it out). */
	title?: string | null;
	reportsTo: string | null;
	/** Retired (it left the organization): when and why; null for a person merely asleep. */
	retiredAt?: number | null;
	retiredReason?: string | null;
	/** Its git repository's directory, or null outside one. */
	repository: string | null;
	cwd: string;
	/** Its focused assignment, retained while it sleeps. */
	task: { title: string; status: string | null; bundle: string } | null;
	/** When its last incarnation ended (ms), and why (`exited`, `lost`, ...); null when unknown. */
	stoppedAt: number | null;
	stopReason: string | null;
	specialization?: string | null;
	hiredAt?: number | null;
	startedAt: number;
}

/** The label mail from the operator carries as its sender (`from`), so agents can tell it from mail between them. */
export const OPERATOR = "operator";

/** A theme pack the operator can choose in Settings, and what is wrong with it (nothing for a good one). */
export interface ThemeChoice {
	id: string;
	name: string;
	description: string | null;
	/** Each fault the pack check found: the file in the pack, and what is wrong with it. */
	problems: { file: string; fault: string }[];
}

/** One mail, as the runtime's `mail` view records it. */
export interface MailItem {
	id: string;
	/** The sender's session id, or a label such as `operator` for mail from outside Pi. */
	from: string;
	fromName: string;
	to: string;
	toName: string;
	/** The letter, cut at `MAIL_BODY_MAX` characters. */
	body: string;
	sentAt: number;
	deliveredAt: number | null;
	/** Delivered once the receiver's transcript records it; waiting until then (as for a dormant receiver). */
	state: "delivered" | "waiting" | "failed";
	reason: string | null;
}

export interface MailThreadSummary {
	id: string;
	subject: string;
	unread: number;
	lastAt: number;
}

export interface MailThread {
	/** Operator cursor before this read acknowledged its returned messages; absent for a preview. */
	readUpTo?: number;
	id: string;
	subject: string;
	closed: boolean;
	participants: { id: string; name: string }[];
	messages: { seq: number; from: string; name: string; body: string; at: number }[];
}

export type ThreadRead = { ok: true; thread: MailThread } | { ok: false; reason: string };

export const MAIL_BODY_MAX = 4000;

/** The longest name the operator gives an agent from the world (renaming); the backend refuses longer. */
export const NAME_MAX = 60;

/**
 * How far a command the operator sent from a place got: the runtime's last receipt stage (with its note, such as why
 * mail waits), or why it failed. `confirm` asks the operator to confirm first (ending a busy session); nothing was
 * sent then.
 */
export type CommandReceipt =
	| { ok: true; stage: "accepted" | "delivered" | "applied"; note?: string }
	| { ok: false; reason: string; confirm?: boolean };

/** A new person with optional initial work; without work, it starts ready for instructions. */
export interface RecruitRequest {
	name: string;
	cwd: string;
	brief?: string;
	reportsTo?: string;
	/** The catalog role it is hired into; none for a session with no role. */
	role?: string;
	specialization?: string;
}

/** A role a person can be hired into, as the catalog describes it. */
export interface RoleChoice {
	name: string;
	title: string;
	mandate: string;
	manages: boolean;
	writes: boolean;
}

/** How a recruit went: a command receipt, with the new session's id once `start` was sent. */
export type RecruitReceipt = CommandReceipt & { sessionId?: string };

/** A place outside any headquarters: the square, or a place off it. */
export function isOutside(place: PlaceRef): place is { kind: OutsideKind } {
	return (OUTSIDE_KINDS as readonly string[]).includes(place.kind);
}

/** One string per place, for maps and scene data. */
export function placeKey(place: PlaceRef): string {
	if (isOutside(place)) return place.kind;
	if (place.kind === "wing") return `wing:${place.headquarters}:${place.repository}`;
	return `${place.kind}:${place.headquarters}`;
}

/** What a chatbox line from the runtime is about; the chatbox filters by it. */
export type FeedKind = "agents" | "mail" | "commands";

/** One runtime event worth a line in the chatbox. */
export interface FeedLine {
	/** The event's sequence number in the runtime's `events` table. */
	seq: number;
	at: number;
	kind: FeedKind;
	/** The character it is about, and its name then. */
	character: string | null;
	name: string | null;
	text: string;
}

export type TerminalResult = { ok: true } | { ok: false; reason: string };

/** One tool call inside an assistant message, folded to a line: its name and main argument, its input on demand. */
export interface TranscriptToolCall {
	id: string;
	name: string;
	/** The main argument (command, path, pattern, ...), first line only. */
	arg: string | null;
	/** The arguments as indented JSON, cut at `TRANSCRIPT_TEXT_MAX`. */
	input: string;
}

/** A piece of an assistant message, in the order the model wrote them. */
export type TranscriptPart =
	| { kind: "text"; text: string }
	| { kind: "thinking"; text: string }
	| { kind: "tool"; call: TranscriptToolCall };

/**
 * One entry of a character's conversation, read from its session's transcript and trimmed for the conversation panel.
 * Long text is cut at `TRANSCRIPT_TEXT_MAX` characters (`cut` says so); the whole is in the session's JSONL.
 */
export type TranscriptEntry =
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
	/** Mail from another session (or the operator), delivered into the transcript. */
	| { kind: "mail"; id: string; at: number; from: string; text: string }
	/** Any other extension's message, such as a reminder or injected context. */
	| { kind: "note"; id: string; at: number; label: string; text: string; shown: boolean };

/** Longest text of one transcript field sent to the world UI. */
export const TRANSCRIPT_TEXT_MAX = 20_000;

/**
 * One page of a conversation, oldest entry first. `before` is the cursor for the page before it, or null at the start
 * of the history. `missing` counts indexed entries the transcript no longer holds.
 */
export type ConversationPage =
	| { ok: true; entries: TranscriptEntry[]; before: string | null; missing: number }
	| { ok: false; reason: string };

/** How a command sent to the runtime ended: applied, or failed with the runtime's reason. */
export type CommandResult = { ok: true } | { ok: false; reason: string };

/** How far a command got, as the runtime reports it (`docs/session-state.md`, Commands). */
export type ReceiptStage = "accepted" | "delivered" | "applied" | "failed";

/** One stage of a command the world UI sent, by the id it chose. `reason` comes with `failed`. */
export interface Receipt {
	commandId: string;
	characterId: string;
	stage: ReceiptStage;
	reason?: string;
}

/** One question of an open `ask_user_question` questionnaire, as the tool was called with it. */
export interface Question {
	question: string;
	header: string | null;
	options: { label: string; description: string }[];
	multiSelect: boolean;
}

export interface Questionnaire {
	/** The prompt's id, which the `answer` command names. */
	id: string;
	questions: Question[];
}

/** One answer per question, in order: the chosen option labels, or free text. */
export type QuestionnaireReply = { selected: string[] } | { custom: string };

/**
 * What the conversation panel asks an agent to do (decision 13): reply to it idle (`talk`), redirect it now (`steer`),
 * tell it after this turn (`follow_up`), stop it (`abort`, which needs `confirmed` while it is busy), or answer its
 * questionnaire.
 */
export type Instruction =
	| { kind: "talk" | "steer" | "follow_up"; text: string }
	| { kind: "abort"; confirmed?: boolean }
	| { kind: "answer"; questionnaire: string; replies: QuestionnaireReply[] };

/**
 * A watched character's reply as it is written: each piece of text (`delta`, in order within its `streamId`), then
 * its end, with the stored transcript entry that replaces the streamed text (null when none was recorded, as for an
 * aborted reply). An end also closes every earlier stream of that character.
 */
export type ReplyStreamEvent =
	| { kind: "delta"; characterId: string; streamId: string; seq: number; delta: string }
	| { kind: "end"; characterId: string; streamId: string; entry: TranscriptEntry | null };

/** A coordinator's notepad as read: its file's path and text (empty until first saved), or why it cannot be read. */
export type NotepadRead = { ok: true; path: string; text: string } | { ok: false; reason: string };
/** A save, or why not; `changed` is the file's text when it changed on disk since the text the save started from. */
export type NotepadSave = { ok: true } | { ok: false; reason: string; changed?: string };
/** The open notepad's file changed on disk (an agent, or an editor, wrote it). */
export interface NotepadChange {
	coordinatorId: string;
	text: string;
}

/**
 * What the preload bridge exposes to the world UI as `window.agentWorld`; the function places' part (GitHub, Jira,
 * Confluence, Slack, the outside-write gate, delegation) is in `integrations.ts`.
 */
export interface AgentWorldApi extends IntegrationsApi {
	workspace: WorkspaceApi;
	terminal: TerminalApi;
	snapshot(): Promise<WorldSnapshot>;
	/**
	 * Called with the new snapshot after every change, whole but for the parts named in `unchanged` (the same as the
	 * update before); returns a function that stops the calls.
	 */
	onUpdate(listener: (update: WorldUpdate) => void): () => void;
	/** The latest feed lines, oldest first. */
	feed(): Promise<FeedLine[]>;
	/** Called with each batch of new feed lines; returns a function that stops the calls. */
	onFeed(listener: (lines: FeedLine[]) => void): () => void;
	/** Switch the operator's tmux client to the character's pane. */
	goToTerminal(characterId: string): Promise<TerminalResult>;
	/** Full Self text on demand, without reading or acknowledging a conversation. */
	profile(characterId: string): Promise<ProfileRead>;
	/** A page of the character's conversation: the newest, or the one just before the cursor `before`. */
	conversation(characterId: string, before?: string): Promise<ConversationPage>;
	/** Tell the runtime the operator saw the character (`mark_seen`); resolves with the command's last receipt. */
	markSeen(characterId: string): Promise<CommandResult>;
	/** Choose the avatar's look (Settings); kept as a session-state preference across app restarts. */
	setAvatarLook(look: string): Promise<CommandResult>;
	/** The theme packs installed, each checked. */
	themes(): Promise<ThemeChoice[]>;
	/** Choose the theme (Settings); kept as a session-state preference across app restarts. */
	setTheme(id: string): Promise<CommandResult>;
	/**
	 * Send an instruction from the conversation panel as its session-state command, under the id the UI chose; each
	 * receipt stage reaches `onReceipt` listeners, and it resolves once the command is applied or has failed.
	 */
	instruct(characterId: string, commandId: string, instruction: Instruction): Promise<CommandResult>;
	/** Called with every receipt stage of instructions sent; returns a function that stops the calls. */
	onReceipt(listener: (receipt: Receipt) => void): () => void;
	/** Stream these characters' replies as they are written (an empty list stops); resolves once the runtime agreed. */
	watchReplies(characterIds: string[]): Promise<void>;
	/** Called with each piece of a watched reply and its end; returns a function that stops the calls. */
	onReply(listener: (event: ReplyStreamEvent) => void): () => void;
	/** Wake a dormant character (`start`): its session opens in a new tmux window after the operator's current pane. */
	wake(characterId: string): Promise<CommandReceipt>;
	/** End an awake character's session (`close`); a busy one asks for `confirmed` first. */
	endSession(characterId: string, confirmed?: boolean): Promise<CommandReceipt>;
	/** Start a mail thread as the operator; messages to a dormant character wait until it wakes. */
	sendMail(characterId: string, body: string): Promise<CommandReceipt>;
	/** Read an operator thread and mark only the returned messages read. */
	readThread(thread: string): Promise<ThreadRead>;
	/** Reply as the operator to everyone in the thread, not as a session prompt. */
	replyThread(thread: string, body: string): Promise<CommandReceipt>;
	/** Read a goal from a task on the board, not from an arbitrary renderer-supplied file path. */
	readTask(task: string): Promise<TaskRead>;
	/** Hand a task to a person as the operator. The runtime owns assignment, focus, notification, and waking. */
	assignTask(person: string, task: string): Promise<CommandReceipt>;
	/** Observe a shared channel, meeting, or task thread; only an operator participant marks it read. */
	readWorkplaceThread(thread: string): Promise<ThreadRead>;
	/**
	 * Join or leave an existing team channel as the operator. A private thread is refused. Joined state is
	 * `workplace.threads[].participants` on the next snapshot. This does not mark the channel read: read it after an
	 * applied receipt to acknowledge the history now visible.
	 */
	setChannelMembership(thread: string, joined: boolean): Promise<CommandReceipt>;
	/**
	 * Recruit a new agent (`start` for a new session id): a worker's window opens after its coordinator's pane, an
	 * independent agent's after the operator's current one.
	 */
	recruit(request: RecruitRequest): Promise<RecruitReceipt>;
	/** Rename an awake character (`rename`); a blank name is refused and nothing is sent. */
	rename(characterId: string, name: string): Promise<CommandReceipt>;
	/** The roles the hire form offers, from the role catalog. */
	roles(): Promise<RoleChoice[]>;
	orgMove(request: OrgMoveRequest): Promise<OrgMoveResult>;
	orgStart(request: OrgStartRequest): Promise<OrgStartProgress>;
	onOrgStart(listener: (progress: OrgStartProgress) => void): () => void;
	/** Retire a character (`retire`): it leaves the organization with a reason, and sleeps at the inn marked so. */
	retire(characterId: string, reason: string): Promise<CommandReceipt>;
	/** Read a running coordinator's notepad (`NOTES.md` in its directory) and watch it for changes. */
	openNotepad(coordinatorId: string): Promise<NotepadRead>;
	/** Write the notepad; refused, with the file's text, when it changed on disk since `base`. */
	saveNotepad(coordinatorId: string, text: string, base: string): Promise<NotepadSave>;
	/** Stop watching the notepad. */
	closeNotepad(): Promise<void>;
	/** Called with each change to the open notepad's file; returns a function that stops the calls. */
	onNotepad(listener: (change: NotepadChange) => void): () => void;
	/**
	 * Open a file a transcript links to (a `file:` URL, or a path, relative ones from `base`, the agent's directory) with
	 * the operator's default app for it; a file that could run is shown in Finder instead.
	 */
	openFile(href: string, base: string): Promise<CommandResult>;
	/** Open a link from a transcript in the system browser: http and https only; the window itself never navigates. */
	openLink(url: string): Promise<CommandResult>;
}
