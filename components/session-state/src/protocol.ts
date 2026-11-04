import type { ReviewCommand } from "../../code-review/src/operations.js";
import type { QuestionnaireReply } from "../../shared/src/questionnaire-events.js";
import type { TurnProgress, TurnResult } from "../../shared/src/turn-observer.js";
import type { RuleEffect, RuleMatch, TriageAction } from "./activity.js";
import type { CanvasWrite } from "./canvases.js";
import type { CommunicationCommand, MessageReference } from "./communication-types.js";
import type { ExternalCommand } from "./external-threads.js";
import type { LinkRecord } from "./links.js";
import type { PeerTurn } from "./peer-turns.js";
import type { RunObservation, RunSnapshot } from "./run-observation.js";
import type { ThreadPost } from "./threads.js";
import type { Worth } from "./valuation.js";
import type { WorkCommand } from "./work.js";

export const PROGRAM_ID_ENV = "PI_PROGRAM_ID";
export const PROGRAM_PARENT_ENV = "PI_PROGRAM_PARENT";

export type RunState = "idle" | "thinking" | "writing_reply" | "running_tool" | "compacting";
export type ProcessState = "starting" | "alive" | "alive_bridge_lost" | "exited" | "lost";

export interface Tool {
	id: string;
	name: string;

	arg?: string;
	since: number;
}

export interface Prompt {
	kind: string;
	title?: string;
	id?: string;
	questions?: unknown;
	url?: string;
}

export interface Facts {
	model: string | null;
	thinkingLevel: string | null;
	contextTokens: number | null;
	contextWindow: number | null;
	cost: number;
	prompt: Prompt | null;

	queue: { steers: number; followUps: number; pending: boolean };
	lastError: string | null;
	lastAbortAt: number | null;

	reportsTo: string | null;

	role: string | null;

	title: string | null;

	manages: boolean | null;

	onCall: boolean | null;

	soul: string | null;

	self: string | null;

	parentSessionFile: string | null;

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

export interface IndexRow {
	entryId: string;
	part: string;
	at: number;
	role: "user" | "assistant" | "tool_call" | "tool_result" | "custom";
	tool?: string;
	size: number;
	preview: string;
}

export interface ReadEntry {
	type: "read_entry";
	requestId: string;
	sessionId: string;
	entryId: string;

	caller?: string;
}

export interface ReadEntries {
	type: "read_entries";
	requestId: string;
	sessionId: string;
	before?: string;
	limit?: number;

	textOnly?: boolean;
}

export interface SearchTranscripts {
	type: "search_transcripts";
	requestId: string;
	query: string;
	sessions?: string[];

	tasks?: string[];

	caller?: string;

	exclude?: { session: string; entries: string[] }[];
	fields?: "words" | "all";
	limit?: number;

	offset?: number;
}

export type Command =
	| { kind: "talk"; text: string }
	| { kind: "steer"; text: string }
	| { kind: "follow_up"; text: string }
	| { kind: "withdraw"; command: string }
	| ({ kind: "run_turn" } & PeerTurn)
	| { kind: "cancel_turn"; turn: string }
	| { kind: "discard_peer" }
	| { kind: "abort" }
	| { kind: "notice"; text: string }
	| { kind: "rename"; name: string }
	| { kind: "set_model"; provider: string; id: string }
	| { kind: "set_thinking"; level: string }
	| { kind: "answer"; questionnaire: string; replies: QuestionnaireReply[] }
	| {
			kind: "mail";
			from: string;
			body: string;
			sentAt: string;

			thread?: string;
			subject?: string;
			seq?: number;
			fromName?: string;
			threadKind?: import("./threads.js").ThreadKind;
			reference?: MessageReference;

			taskGoal?: boolean;
	  }
	| WorkCommand
	| ReviewCommand
	| CommunicationCommand
	| ExternalCommand
	| { kind: "schedule"; to: string; body: string; firstAt: number; everyMs?: number }
	| { kind: "unschedule"; id: string }
	| { kind: "channel_charter"; thread: string; listener: string | null; charter: string | null }
	| ({ kind: "link_record" } & LinkRecord)
	| { kind: "link_resolve"; id: string; resolution?: string }
	| { kind: "task_opened"; bundle: string }
	| { kind: "task_moved"; from: string; to: string; status: "done" | "cancelled" }
	| ({ kind: "thread_post" } & ThreadPost)
	| { kind: "thread_read"; thread: string; seq: number }
	| { kind: "channel_membership"; thread: string; joined: boolean }
	| { kind: "react"; message: string; emoji: string; on: boolean }
	| { kind: "activity_triage"; items: string[]; action: TriageAction; note: string; ref?: string }
	| {
			kind: "activity_rule";
			match: RuleMatch;
			effect: RuleEffect;
			person?: string;
			note: string;
			remove?: string;
	  }
	| { kind: "canvas"; write: CanvasWrite }
	| {
			kind: "note";
			update?: string;
			remove?: string;
			title?: string;
			body?: string;
			topics?: string[];
			refs?: string[];
	  }
	| {
			kind: "start";
			tmux?: { socket: string; pane: string };
			cwd?: string;
			name?: string;
			reportsTo?: string;

			role?: string;

			specialization?: string;

			profile?: string;

			goal?: { text: string; by: string; title?: string } & Worth;
			prompt?: string;
	  }
	| { kind: "close" }
	| { kind: "transfer"; manager: string; by: string }
	| { kind: "organization_move"; person: string; manager: string | null; branch: string[] }
	| { kind: "retire"; reason: string; by?: string; handoff?: boolean }
	| { kind: "mark_seen" }
	| { kind: "set_preference"; key: string; value: unknown };

export interface CommandRequest {
	type: "command";
	commandId: string;
	sessionId: string;
	generation?: number;
	command: Command;
}

export type ReceiptStage = "accepted" | "delivered" | "applied" | "failed";

export interface Receipt {
	type: "receipt";
	commandId: string;
	stage: ReceiptStage;
	reason?: string;

	result?: TurnResult;
}

export type EntryReply =
	| { type: "entry"; requestId: string; entry: unknown }
	| { type: "entry"; requestId: string; error: string; refused?: true };

export type EntriesReply =
	| {
			type: "entries";
			requestId: string;
			entries: unknown[];
			before: string | null;
			missing?: string[];

			reactions?: Record<string, { emoji: string; people: string[] }[]>;
	  }
	| { type: "entries"; requestId: string; error: string };

export interface Subscribe {
	type: "subscribe";
	sessionIds: string[];
}

export interface Subscribed {
	type: "subscribed";
	sessionIds: string[];
}

export interface ReplyDelta {
	type: "reply_delta";
	sessionId: string;
	streamId: string;
	seq: number;
	delta: string;
}

export interface ReplyEnd {
	type: "reply_end";
	sessionId: string;
	streamId: string;
	messageEntryId?: string;
}

export interface Hello {
	type: "hello";

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

	tmux?: { socket: string; pane: string };
	run: RunState;
	execution?: RunSnapshot;
	facts: Facts;
	tool?: Tool;
}

export type BridgeMessage =
	| { type: "program_open"; id: string; caller: string }
	| { type: "program_close" }
	| Hello
	| { type: "heartbeat" }
	| { type: "run"; run: RunState }
	| { type: "execution"; observation: RunObservation }
	| { type: "facts"; facts: Partial<Facts> }
	| { type: "tool_start"; tool: Tool }
	| { type: "tool_end"; id: string; name: string; durationMs: number; isError: boolean; current: Tool | null }
	| { type: "index"; rows: IndexRow[] }
	| CommandRequest
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
	| SearchTranscripts
	| Subscribe
	| Omit<ReplyDelta, "sessionId">
	| Omit<ReplyEnd, "sessionId">
	| { type: "shutdown"; reason: string };

export const HEARTBEAT_MS = 1000;
export const SILENCE_MS = 5000;

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
