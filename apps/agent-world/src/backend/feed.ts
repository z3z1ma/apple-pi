// The chatbox's feed: new rows of the runtime's `events` table, by sequence, turned into plain lines about characters.
// Only what the operator follows is a line: sessions starting and stopping, runs settling, questions opening and
// closing, mail, and commands with their failures. Tools, facts, tmux, and the views' own bookkeeping are not.
import { basename } from "node:path";
import type { FeedLine } from "../world.js";

/** The event types that can become lines; others are skipped in the query. */
export const FEED_TYPES = [
	"incarnation_started",
	"incarnation_ended",
	"run_state",
	"prompt_opened",
	"prompt_closed",
	"command_accepted",
	"command_applied",
	"command_failed",
] as const;

/** New events of `FEED_TYPES` after a sequence number, with their session's name; `?` is the last seq read. */
export const FEED_SINCE = `select e.seq, e.at, e.session_id as sessionId, e.generation, e.type, e.data,
	s.name, s.cwd, s.kind as sessionKind
from events e left join sessions s on s.id = e.session_id
where e.seq > ? and e.type in (${FEED_TYPES.map((type) => `'${type}'`).join(", ")})
order by e.seq limit 500`;

export interface FeedRow {
	seq: number;
	at: number;
	sessionId: string | null;
	generation: number | null;
	type: string;
	data: string | null;
	name: string | null;
	cwd: string | null;
	sessionKind: string | null;
}

/** What the feed needs to look up: a command by id, and a session's name by id (for mail senders). */
export interface FeedLookup {
	command(commandId: string): { kind: string; command: Record<string, unknown> } | undefined;
	name(sessionId: string): string | undefined;
}

/** How a command reads in a line, as "<label> for <name>". Commands the views send for themselves have none. */
const LABELS: Record<string, string> = {
	talk: "Message",
	steer: "Redirect",
	follow_up: "Follow-up",
	abort: "Stop",
	close: "Close",
	answer: "Answer",
	rename: "Rename",
	set_model: "Model change",
	set_thinking: "Thinking change",
	start: "Start",
};

const PREVIEW = 120;

function preview(text: unknown): string {
	const flat = typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
	return flat.length > PREVIEW ? `${flat.slice(0, PREVIEW - 1)}\u2026` : flat;
}

function parse(json: string | null): Record<string, unknown> {
	if (!json) return {};
	try {
		const value = JSON.parse(json) as unknown;
		return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
	} catch {
		return {};
	}
}

/** What a command says beyond its label: the text it carries. */
function detail(command: Record<string, unknown>): string {
	if (command.kind === "rename") return preview(command.name);
	if (command.kind === "set_model") return preview(command.id);
	if (command.kind === "set_thinking") return preview(command.level);
	return preview(command.text ?? command.prompt);
}

/** The line for one event, or undefined when it is not one the operator follows. */
export function feedLine(row: FeedRow, lookup: FeedLookup): FeedLine | undefined {
	if (row.sessionKind === "child") return undefined; // subagents are not characters
	const name = row.name || (row.cwd ? basename(row.cwd) : null) || row.sessionId;
	const data = parse(row.data);
	const line = (kind: FeedLine["kind"], text: string): FeedLine => ({
		seq: row.seq,
		at: row.at,
		kind,
		character: row.sessionId,
		name,
		text,
	});
	switch (row.type) {
		case "incarnation_started":
			return line("agents", (row.generation ?? 1) > 1 ? `${name} started again.` : `${name} started.`);
		case "incarnation_ended":
			// A reopen supersedes the old process; the new start says enough.
			if (data.reason === "superseded") return undefined;
			return line("agents", `${name} stopped${typeof data.reason === "string" ? ` (${data.reason})` : ""}.`);
		case "run_state":
			// A settle: a run back to idle, as the runtime counts it (a compaction outside a run is not one).
			return data.to === "idle" && data.from !== "compacting"
				? line("agents", `${name} finished its turn.`)
				: undefined;
		case "prompt_opened": {
			const prompt = (data.to ?? {}) as { title?: unknown; questions?: unknown };
			const first = Array.isArray(prompt.questions) ? (prompt.questions[0] as { question?: unknown }) : undefined;
			const asks = preview(prompt.title ?? first?.question);
			return line("agents", asks ? `${name} asks: ${asks}` : `${name} asks you something.`);
		}
		case "prompt_closed":
			return line("agents", `${name}'s question was answered.`);
		case "command_accepted": {
			const command = (data.command ?? {}) as Record<string, unknown>;
			if (command.kind === "mail") {
				const from = typeof command.from === "string" ? (lookup.name(command.from) ?? command.from) : "someone";
				return line("mail", `Mail from ${from} to ${name}: ${preview(command.body)}`);
			}
			const label = LABELS[String(command.kind)];
			if (!label) return undefined;
			const said = detail(command);
			return line("commands", said ? `${label} for ${name}: ${said}` : `${label} for ${name}.`);
		}
		case "command_applied":
		case "command_failed": {
			const command = typeof data.commandId === "string" ? lookup.command(data.commandId) : undefined;
			const label = command ? LABELS[command.kind] : undefined;
			if (!label) return undefined;
			if (row.type === "command_failed")
				return line("commands", `${label} for ${name} failed: ${preview(data.reason) || "no reason given"}.`);
			// A start is applied when the session connects, which its own start line says.
			return command?.kind === "start" ? undefined : line("commands", `${name} took the ${label.toLowerCase()}.`);
		}
	}
	return undefined;
}
