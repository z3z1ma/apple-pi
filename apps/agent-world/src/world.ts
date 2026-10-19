// The world as the backend reports it to the world UI. Shared by the backend, the preload bridge, and the renderer.

/**
 * A coordinator keeps a headquarters; a worker reports to a coordinator; an independent session reports to none
 * (`.wiki/pages/agent-world-language.md`).
 */
export type Role = "coordinator" | "worker" | "independent";

/** Where an awake character is. Headquarters, and the places inside them, are keyed by their coordinator's id. */
export type PlaceRef =
	| { kind: "headquarters" | "common-room" | "gallery"; headquarters: string }
	| { kind: "wing"; headquarters: string; repository: string }
	/** Outside: the village square, the inn where dormant agents sleep, and the rookery where mail comes and goes. */
	| { kind: "square" | "inn" | "rookery" };

/** A session's run state as the runtime records it. */
export type RunState = "idle" | "thinking" | "writing_reply" | "running_tool" | "compacting";

/** What the sidebar shows: asking (an open prompt), working (any run state but idle), or idle. */
export type Status = "asking" | "working" | "idle";

/** Observed facts about a character, as the session-state runtime records them (`docs/session-state.md`). */
export interface CharacterFacts {
	run: RunState;
	status: Status;
	/**
	 * The open prompt: its kind, and its title or first question. An `ask_user_question` questionnaire also carries its
	 * id and questions, so the conversation panel can answer it; any other dialog is answered only in the terminal.
	 */
	asking: { kind: string; text: string | null; questionnaire?: Questionnaire } | null;
	/** Since when it has needed the operator (an open prompt, or a settle not seen yet); null when it does not. */
	needsYouSince: number | null;
	/** Finished and unseen: it needs the operator with no prompt open. */
	unseen: boolean;
	seenAt: number | null;
	settledAt: number | null;
	/** The top-level tool running now, with its main argument (command, path, ...). */
	tool: { name: string; arg: string | null; since: number | null } | null;
	/** The ledger task it touched last: the title from its `task.md` heading and its Status line. */
	task: { title: string; status: string | null; bundle: string } | null;
	git: { repository: string; worktree: string; branch: string } | null;
	cwd: string;
	reportsTo: string | null;
	model: string | null;
	contextTokens: number | null;
	contextWindow: number | null;
	cost: number;
	/** Its tmux pane, with the tmux session and window that show it when the runtime has seen them. */
	tmux: { socket: string; pane: string; session: string | null; window: number | null } | null;
}

/** One awake top-level Pi session. */
export interface Character {
	id: string;
	name: string;
	role: Role;
	place: PlaceRef;
	/** When the session first started (ms); characters are listed in this order, so nobody moves when another leaves. */
	startedAt: number;
	/** Always set by the backend; fixtures that test only places may leave it out. */
	facts?: CharacterFacts;
}

/** One repository's wing. It stays once seen, boarded up while nobody works in it. */
export interface Wing {
	/** The repository's directory (the main checkout, shared by its worktrees). */
	repository: string;
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
	/** Every stopped top-level session, asleep at the inn: the most recently stopped first. */
	dormant?: DormantAgent[];
	/** Recent mail between sessions (and from the operator), newest first, with every mail still waiting. */
	mail?: MailItem[];
}

/** A stopped top-level session (a dormant character): it sleeps at the inn until it is woken. */
export interface DormantAgent {
	id: string;
	name: string;
	/** What it was while awake; a dormant coordinator keeps its look. */
	role: Role;
	reportsTo: string | null;
	/** Its git repository's directory, or null outside one. */
	repository: string | null;
	cwd: string;
	/** The ledger task it touched last. */
	task: { title: string; status: string | null; bundle: string } | null;
	/** When its last incarnation ended (ms), and why (`exited`, `lost`, ...); null when unknown. */
	stoppedAt: number | null;
	stopReason: string | null;
	startedAt: number;
}

/** The label mail from the operator carries as its sender (`from`), so agents can tell it from mail between them. */
export const OPERATOR = "operator";

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

export const MAIL_BODY_MAX = 4000;

/**
 * How far a command the operator sent from a place got: the runtime's last receipt stage (with its note, such as why
 * mail waits), or why it failed. `confirm` asks the operator to confirm first (ending a busy session); nothing was
 * sent then.
 */
export type CommandReceipt =
	| { ok: true; stage: "accepted" | "delivered" | "applied"; note?: string }
	| { ok: false; reason: string; confirm?: boolean };

/** A place outside any headquarters: the square, the inn, or the rookery. */
export function isOutside(place: PlaceRef): place is { kind: "square" | "inn" | "rookery" } {
	return place.kind === "square" || place.kind === "inn" || place.kind === "rookery";
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

/** What the preload bridge exposes to the world UI as `window.agentWorld`. */
export interface AgentWorldApi {
	snapshot(): Promise<WorldSnapshot>;
	/** Called with the whole new snapshot after every change; returns a function that stops the calls. */
	onUpdate(listener: (snapshot: WorldSnapshot) => void): () => void;
	/** The latest feed lines, oldest first. */
	feed(): Promise<FeedLine[]>;
	/** Called with each batch of new feed lines; returns a function that stops the calls. */
	onFeed(listener: (lines: FeedLine[]) => void): () => void;
	/** Switch the operator's tmux client to the character's pane. */
	goToTerminal(characterId: string): Promise<TerminalResult>;
	/** A page of the character's conversation: the newest, or the one just before the cursor `before`. */
	conversation(characterId: string, before?: string): Promise<ConversationPage>;
	/** Tell the runtime the operator saw the character (`mark_seen`); resolves with the command's last receipt. */
	markSeen(characterId: string): Promise<CommandResult>;
	/** Choose the avatar's look (Settings); kept as a session-state preference across app restarts. */
	setAvatarLook(look: string): Promise<CommandResult>;
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
	/** Mail a character as the operator (`mail`, from `OPERATOR`); mail to a dormant one waits until it wakes. */
	sendMail(characterId: string, body: string): Promise<CommandReceipt>;
	/** Open a link from a transcript in the system browser: http and https only; the window itself never navigates. */
	openLink(url: string): Promise<CommandResult>;
}
