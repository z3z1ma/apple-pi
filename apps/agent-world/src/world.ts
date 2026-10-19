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
	| { kind: "square" };

/** A session's run state as the runtime records it. */
export type RunState = "idle" | "thinking" | "writing_reply" | "running_tool" | "compacting";

/** What the sidebar shows: asking (an open prompt), working (any run state but idle), or idle. */
export type Status = "asking" | "working" | "idle";

/** Observed facts about a character, as the session-state runtime records them (`docs/session-state.md`). */
export interface CharacterFacts {
	run: RunState;
	status: Status;
	/** The open prompt: its kind, and its title or first question. */
	asking: { kind: string; text: string | null } | null;
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
}

/** One string per place, for maps and scene data. */
export function placeKey(place: PlaceRef): string {
	if (place.kind === "square") return "square";
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
}
