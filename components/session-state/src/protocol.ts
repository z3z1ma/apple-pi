// The runtime's socket protocol: bridges send one JSON object per line.

import type { QuestionnaireReply } from "../../shared/src/questionnaire-events.js";

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
	/** The coordinator session this one reports to (`--reports-to`). */
	reportsTo: string | null;
	/** The session file this one was forked or cloned from (Pi's `parentSession`). */
	parentSessionFile: string | null;
	/** The session file that ran before this one in the same process (and pane), and why it gave way. */
	previousSession: { file: string; reason: string } | null;
	git: { repository: string; worktree: string; branch: string } | null;
	/**
	 * The ledger task this session touched last. A bridge reports it only once it sees a touch, so a reload or reopen
	 * keeps the task the runtime already recorded.
	 */
	currentTask?: { bundle: string; taskId: string } | null;
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

/** What a client can ask a session to do. */
export type Command =
	| { kind: "talk"; text: string }
	| { kind: "steer"; text: string }
	| { kind: "follow_up"; text: string }
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
	| { kind: "mail"; from: string; body: string; sentAt: string };

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
}

export type EntryReply =
	| { type: "entry"; requestId: string; entry: unknown }
	| { type: "entry"; requestId: string; error: string };

export interface Hello {
	type: "hello";
	/** A child is a subagent session; `spawnedBy` is the session that started it. */
	session: { id: string; kind: "root" | "child"; spawnedBy?: string; file?: string; cwd: string; name?: string };
	process: { pid: number; startedAt: number };
	/** The tmux server socket and pane this session runs in, from its `TMUX` and `TMUX_PANE`; absent outside tmux. */
	tmux?: { socket: string; pane: string };
	run: RunState;
	facts: Facts;
	tool?: Tool;
}

export type BridgeMessage =
	| Hello
	| { type: "heartbeat" }
	| { type: "run"; run: RunState }
	| { type: "facts"; facts: Partial<Facts> }
	| { type: "tool_start"; tool: Tool }
	| { type: "tool_end"; id: string; name: string; durationMs: number; isError: boolean; current: Tool | null }
	| { type: "index"; rows: IndexRow[] }
	| { type: "task_link"; bundle: string; taskId: string; via: string; at: number }
	| CommandRequest
	/** A bridge reporting how far a command it was given got. */
	| { type: "command_progress"; commandId: string; stage: "delivered" | "applied" | "failed"; reason?: string }
	| ReadEntry
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
