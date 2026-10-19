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
	/** Awake workers in it; 0 means boarded up. */
	headcount: number;
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
}
