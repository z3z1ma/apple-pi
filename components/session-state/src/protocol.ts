// The runtime's socket protocol: bridges send one JSON object per line.

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

/** A prompt waiting on the operator: a questionnaire carries its questions; other dialogs only kind and title. */
export interface Prompt {
	kind: string;
	title?: string;
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
	queue: { steers: number; followUps: number };
	lastError: string | null;
	lastAbortAt: number | null;
	config: { name: string | null; activeTools: string[]; extensions: string[]; skills: string[]; mcpServers: string[] };
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

export type EntryReply =
	| { type: "entry"; requestId: string; entry: unknown }
	| { type: "entry"; requestId: string; error: string };

export interface Hello {
	type: "hello";
	session: { id: string; kind: "root"; file?: string; cwd: string; name?: string };
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
	| { type: "tool_end"; id: string; name: string; durationMs: number; isError: boolean }
	| { type: "index"; rows: IndexRow[] }
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
