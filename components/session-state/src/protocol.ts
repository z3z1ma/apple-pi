// The runtime's socket protocol: bridges send one JSON object per line.

import type { QuestionnaireReply } from "../../shared/src/questionnaire-events.js";
import type { TurnProgress, TurnResult } from "../../shared/src/turn-observer.js";
import type { PeerTurn } from "./peer-turns.js";
import type { ThreadPost } from "./threads.js";
import type { WorkCommand } from "./work.js";

export const PROGRAM_ID_ENV = "PI_PROGRAM_ID";
export const PROGRAM_PARENT_ENV = "PI_PROGRAM_PARENT";

export type RunState = "idle" | "thinking" | "writing_reply" | "running_tool" | "compacting";
export type ProcessState = "starting" | "alive" | "alive_bridge_lost" | "exited" | "lost";

/** The top-level tool a session is running now. */
export interface Tool {
	id: string;
	name: string;
	/** The call's main argument (command, path, pattern, ...), first line only. */
	arg?: string;
	since: number;
}

/**
 * A prompt waiting on the operator: a questionnaire carries its questions and the id an `answer` command names;
 * other dialogs only kind and title, and only the terminal answers them.
 */
export interface Prompt {
	kind: string;
	title?: string;
	id?: string;
	questions?: unknown;
}

/** Everything else a bridge knows about its session. Each field is replaced whole when it changes. */
export interface Facts {
	model: string | null;
	thinkingLevel: string | null;
	contextTokens: number | null;
	contextWindow: number | null;
	cost: number;
	prompt: Prompt | null;
	/** Typed steers and follow-ups not yet delivered; `pending` is Pi's own word that anything (an extension's message too) waits. */
	queue: { steers: number; followUps: number; pending: boolean };
	lastError: string | null;
	lastAbortAt: number | null;
	/** The manager session this one reports to (`--reports-to`). */
	reportsTo: string | null;
	/** The role this session holds for life (a role catalog name), or null. */
	role: string | null;
	/** The role's title, for people reading the views; null without a role. */
	title: string | null;
	/** Whether the role manages (holds the manager tools and charter); null without a role. */
	manages: boolean | null;
	/** One line of the soul drawn at hire, or null without a role. */
	soul: string | null;
	/** The person's self: the document it keeps about itself and its teammates, or null before its first `update_self`. */
	self: string | null;
	/** The session file this one was forked or cloned from (Pi's `parentSession`). */
	parentSessionFile: string | null;
	/** The session file that ran before this one in the same process (and pane), and why it gave way. */
	previousSession: { file: string; reason: string } | null;
	git: { repository: string; worktree: string; branch: string } | null;
	config: {
		name: string | null;
		flags: string[];
		activeTools: string[];
		extensions: string[];
		skills: string[];
		mcpServers: string[];
	};
}

/**
 * One completed piece of conversation: a message (`part` ""), or a tool call inside an assistant message (`part`
 * is the tool call id). The text itself stays in the session's JSONL; `read_entry` fetches it.
 */
export interface IndexRow {
	entryId: string;
	part: string;
	at: number;
	role: "user" | "assistant" | "tool_call" | "tool_result" | "custom";
	tool?: string;
	size: number;
	preview: string;
}

/** Any client may ask for one session entry; the runtime answers on the same connection with `EntryReply`. */
export interface ReadEntry {
	type: "read_entry";
	requestId: string;
	sessionId: string;
	entryId: string;
}

/**
 * Any client may ask for a page of a session's transcript entries, keyed by the ordered ids in its `messages` index:
 * the newest `limit` entries, or those just before the entry `before`. The runtime answers with `EntriesReply`.
 */
export interface ReadEntries {
	type: "read_entries";
	requestId: string;
	sessionId: string;
	before?: string;
	limit?: number;
}

/** What a client can ask a session to do. */
export type Command =
	| { kind: "talk"; text: string }
	| { kind: "steer"; text: string }
	| { kind: "follow_up"; text: string }
	/** Wait for idle, run a program's request, and return that run's reply on its command receipt. */
	| ({ kind: "run_turn" } & PeerTurn)
	/** Cancel only this program request, whether queued or currently running. */
	| { kind: "cancel_turn"; turn: string }
	/** Discard only a temporary peer owned by this program connection. */
	| { kind: "discard_peer" }
	| { kind: "abort" }
	| { kind: "rename"; name: string }
	| { kind: "set_model"; provider: string; id: string }
	| { kind: "set_thinking"; level: string }
	/** Answers the open questionnaire `questionnaire` (its prompt id), one reply per question, unless the terminal answered first. */
	| { kind: "answer"; questionnaire: string; replies: QuestionnaireReply[] }
	/**
	 * Mail from `from` (a session id, or a name such as "shell"). Unlike every other command it waits while the session
	 * is not running and is delivered when it next opens; it is applied once the session's transcript records it.
	 */
	| {
			kind: "mail";
			from: string;
			body: string;
			sentAt: string;
			/** Mail that carries a thread message: its thread, subject, sequence number, and the sender's name. */
			thread?: string;
			subject?: string;
			seq?: number;
			fromName?: string;
			/** Read the recipient's current goal when delivering this assignment/focus notification. */
			taskGoal?: boolean;
	  }
	| WorkCommand
	/** A ledger archive changes a known task's path, never its assignments. */
	| { kind: "task_moved"; from: string; to: string }
	/**
	 * Post a message from the request's session (or a named outside sender) to a thread, creating it when new. Applied
	 * by the runtime, which pushes the message as mail to each pushed participant; the reason names who is asleep.
	 */
	| ({ kind: "thread_post" } & ThreadPost)
	/** The session has read `thread` up to message `seq`. Applied by the runtime. */
	| { kind: "thread_read"; thread: string; seq: number }
	/**
	 * Start the session (a new id, or a stopped session by its id) with `pi` in a new tmux window after `tmux.pane`'s
	 * window. The runtime opens the window itself; `cwd` and `name` default to the stopped session's. Applied when the
	 * session's bridge connects; failed when the window closes first.
	 */
	| {
			kind: "start";
			tmux?: { socket: string; pane: string };
			cwd?: string;
			name?: string;
			reportsTo?: string;
			/** The role a new session is hired into; a stopped session keeps the role its transcript records. */
			role?: string;
			/** Written work, assigned before the new process starts so its first turn receives the goal. */
			goal?: { text: string; by: string };
			prompt?: string;
	  }
	/** Quit the session's Pi process. */
	| { kind: "close" }
	/**
	 * Move the person under another manager, which must be in its organization and not in its own subtree; its
	 * reports move with it. Applied by the runtime, which tells the running bridge (so later close notices go to the
	 * new manager); `by` is the acting manager's session id, for the record.
	 */
	| { kind: "transfer"; manager: string; by: string }
	/** Record that the person left (when and why) and close it when it runs. Applied by the runtime. */
	| { kind: "retire"; reason: string }
	/** The operator saw the session: it no longer needs them unless a prompt is open. Applied by the runtime. */
	| { kind: "mark_seen" }
	/**
	 * Store a view's choice under `key` in `preferences`, replacing the old value. Applied by the runtime; it belongs to
	 * no session, so the request's `sessionId` only names the client (the notch sends "notch") and is not checked.
	 */
	| { kind: "set_preference"; key: string; value: unknown };

/**
 * A client's request. `commandId` is the client's own id, so a repeat applies once. With `generation`, the command
 * is bound to that incarnation and never reaches a later one; without it, it goes to the current one.
 */
export interface CommandRequest {
	type: "command";
	commandId: string;
	sessionId: string;
	generation?: number;
	command: Command;
}

export type ReceiptStage = "accepted" | "delivered" | "applied" | "failed";

/** Sent to the requesting client for each stage a command reaches; never "done": effects show as observed events. */
export interface Receipt {
	type: "receipt";
	commandId: string;
	stage: ReceiptStage;
	reason?: string;
	/** A run's return value, sent once to its waiting caller; the transcript remains its durable record. */
	result?: TurnResult;
}

export type EntryReply =
	| { type: "entry"; requestId: string; entry: unknown }
	| { type: "entry"; requestId: string; error: string };

/**
 * A page of entries in transcript order. `before` is the cursor for the page before (the first entry's id), or null
 * when the page starts at the session's first indexed entry. `missing` lists indexed ids the transcript no longer holds.
 */
export type EntriesReply =
	| { type: "entries"; requestId: string; entries: unknown[]; before: string | null; missing?: string[] }
	| { type: "entries"; requestId: string; error: string };

/**
 * A client asks for the live reply streams of `sessionIds`. Each subscribe replaces the connection's earlier
 * one; an empty list ends it. The runtime confirms with
 * `Subscribed` before relaying anything.
 */
export interface Subscribe {
	type: "subscribe";
	sessionIds: string[];
}

export interface Subscribed {
	type: "subscribed";
	sessionIds: string[];
}

/**
 * Transient reply text, relayed to subscribers and never stored. `seq` counts the stream's deltas from 1; a delta that
 * several were coalesced into carries the last one's `seq` and all their text, so `seq` may skip but no text is lost.
 */
export interface ReplyDelta {
	type: "reply_delta";
	sessionId: string;
	streamId: string;
	seq: number;
	delta: string;
}

/**
 * A reply stream is over. `messageEntryId` names the stored transcript entry (from Pi's `turn_end`) that replaces
 * the streamed text; it is absent when Pi recorded none (an aborted or failed reply). Every earlier unfinished stream
 * of the session is over too.
 */
export interface ReplyEnd {
	type: "reply_end";
	sessionId: string;
	streamId: string;
	messageEntryId?: string;
}

export interface Hello {
	type: "hello";
	/** Current bridges report root sessions; child identity remains readable for historical records. */
	session: {
		id: string;
		kind: "root" | "child";
		spawnedBy?: string;
		file?: string;
		cwd: string;
		name?: string;
		program?: { id: string; parent: string };
	};
	process: { pid: number; startedAt: number };
	/** The tmux server socket and pane this session runs in, from its `TMUX` and `TMUX_PANE`; absent outside tmux. */
	tmux?: { socket: string; pane: string };
	run: RunState;
	facts: Facts;
	tool?: Tool;
}

export type BridgeMessage =
	| { type: "program_open"; id: string; caller: string }
	| { type: "program_close" }
	| Hello
	| { type: "heartbeat" }
	| { type: "run"; run: RunState }
	| { type: "facts"; facts: Partial<Facts> }
	| { type: "tool_start"; tool: Tool }
	| { type: "tool_end"; id: string; name: string; durationMs: number; isError: boolean; current: Tool | null }
	| { type: "index"; rows: IndexRow[] }
	| CommandRequest
	/** A bridge reporting how far a command it was given got. */
	| {
			type: "command_progress";
			commandId: string;
			stage: "delivered" | "applied" | "failed";
			reason?: string;
			result?: TurnResult;
	  }
	| { type: "turn_progress"; commandId: string; progress: TurnProgress }
	| ReadEntry
	| ReadEntries
	| Subscribe
	/** The bridge's own session is implied by its connection. */
	| Omit<ReplyDelta, "sessionId">
	| Omit<ReplyEnd, "sessionId">
	| { type: "shutdown"; reason: string };

/** A bridge sends a heartbeat this often; the runtime treats a bridge silent for SILENCE_MS as lost. */
export const HEARTBEAT_MS = 1000;
export const SILENCE_MS = 5000;

/** Split a byte stream into complete lines; a partial final line waits for its newline. */
export function lineReader(onLine: (line: string) => void): (chunk: Buffer | string) => void {
	let buffer = "";
	return (chunk) => {
		buffer += chunk.toString();
		for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
			const line = buffer.slice(0, end);
			buffer = buffer.slice(end + 1);
			if (line.trim()) onLine(line);
		}
	};
}
