import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { type SessionEntry, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";

import {
	formatBashReceipt,
	formatBytes,
	formatResultReceipt,
	lineCount,
	truncateResultBody,
	utf8Bytes,
} from "./receipts.js";
import type { AdvisorNote } from "./types.js";

const ADVISORY_TYPE = "advisory";

/** Render held advisories as the reconfirmation preamble for the next review. */
export function formatReconfirmPreamble(held: readonly AdvisorNote[]): string {
	if (!held.length) return "";
	const items = held.map((note) => `- [${(note.severity ?? "nit").toUpperCase()}] ${note.note}`).join("\n");
	return [
		"### Held advisories — reconfirm",
		"",
		"You raised these on an earlier step; they were held pending reconfirmation, because by now the agent may have already addressed them. Re-check each against the latest activity below.",
		"For every item that STILL applies, call `advise` again — same severity, or higher if it's gotten worse; never lower it. Say nothing for the rest — silence drops them. Do NOT call `advise` to announce that an item is resolved or that all are cleared; just stay silent.",
		"",
		items,
		"",
		"---",
		"",
	].join("\n");
}

const ADVISOR_GUIDANCE = "weigh, don't blindly obey";
const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Render notes as the agent-facing message body: one `<advisory>` per note.
 * `stale` adds a `context` attribute noting the advice is about an earlier step
 * (used for nits, which the advisor always raises a little behind the agent).
 * `finalAnswer` appends guidance for advice delivered as a followup to a terminal
 * message: at the moment it is steered in, the primary is stopped having returned
 * a final answer this turn — regardless of which turn generated the note. If the
 * agent acts on it, it should reply with a fresh, self-contained final answer rather
 * than a terse follow-up — so the user reads one complete answer, not a
 * back-and-forth thread it has to stitch together.
 */
export function formatAdvisoryContent(
	notes: readonly AdvisorNote[],
	opts?: { stale?: boolean; finalAnswer?: boolean },
): string {
	const context = opts?.stale ? ` context="raised about an earlier step"` : "";
	const body = notes
		.map((n) => {
			const sev = n.severity ? ` severity="${n.severity}"` : "";
			return `<advisory${sev}${context} guidance="${ADVISOR_GUIDANCE}">\n${escapeXml(n.note)}\n</advisory>`;
		})
		.join("\n");
	if (!opts?.finalAnswer) return body;
	return `${body}\n\nYou had already returned a final answer to the user this turn. If you act on the advice above, respond with a new, self-contained final answer that fully stands on its own — do NOT write a terse follow-up that assumes the user read your previous message. The user should be able to read your new reply alone and get the complete answer.`;
}

// ---- transcript delta formatting (primary turn → markdown for the advisor) ----

function textOf(content: Array<{ type: string; text?: string }>): string {
	return content
		.filter((c) => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text as string)
		.join("");
}

// Render any tool-call argument value as readable text with REAL newlines preserved
// at EVERY depth. We never JSON.stringify content: that escapes every real newline
// into a literal backslash-n (so a heredoc body reaches the advisor as `<<'EOF'\n...`
// — the exact bug that produced a bogus "garbled markdown" advisory), and escaping
// only at the top level merely pushes the bug into nested strings (e.g. edits[].oldText).
// String leaves ride verbatim; containers are walked. Tool args are plain JSON data
// from the model, so there are no cycles or non-serializable leaves to guard against;
// a depth cap is the only (never-hit-in-practice) backstop.
function renderArgValue(v: unknown, indent: string, depth: number): string {
	// Multiline strings ride raw on following lines — NOT re-indented, which would
	// alter the very content (e.g. a heredoc body) the advisor must see verbatim.
	if (typeof v === "string") return v.includes("\n") ? `\n${v}` : ` ${v}`;
	if (v === null || typeof v !== "object") return ` ${String(v)}`;
	if (depth >= 8) return " […]";
	const childIndent = `${indent}  `;
	if (Array.isArray(v)) {
		if (v.length === 0) return " []";
		return v.map((e, i) => `\n${indent}- [${i}]${renderArgValue(e, childIndent, depth + 1)}`).join("");
	}
	const entries = Object.entries(v as Record<string, unknown>);
	if (entries.length === 0) return " {}";
	return entries.map(([k, val]) => `\n${indent}${k}:${renderArgValue(val, childIndent, depth + 1)}`).join("");
}

function renderToolArgs(args: Record<string, unknown> | undefined): string {
	if (!args || typeof args !== "object") return "";
	const entries = Object.entries(args);
	if (entries.length === 0) return "";
	return entries.map(([k, v]) => `${k}:${renderArgValue(v, "  ", 0)}`).join("\n");
}

function exitSuffix(tr: ToolResultMessage): string {
	const details = (tr as { details?: { exitCode?: unknown; exit_code?: unknown } }).details;
	const code = details?.exitCode ?? details?.exit_code;
	return typeof code === "number" ? ` exit ${code}` : "";
}

function indexSuccessfulDiffs(results: readonly ToolResultMessage[]): Map<string, string> {
	const diffByCallId = new Map<string, string>();
	for (const tr of results) {
		const id = (tr as { toolCallId?: string }).toolCallId;
		const d = (tr as { details?: { diff?: unknown } }).details?.diff;
		if (id && !tr.isError && typeof d === "string" && d.trim()) diffByCallId.set(id, d);
	}
	return diffByCallId;
}

function indexFailedCallIds(results: readonly ToolResultMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const tr of results) {
		const id = (tr as { toolCallId?: string }).toolCallId;
		if (id && tr.isError) ids.add(id);
	}
	return ids;
}

function formatWriteCall(args: Record<string, unknown> | undefined, failed: boolean): string {
	const path = typeof args?.path === "string" && args.path ? args.path : "?";
	const content = typeof args?.content === "string" ? args.content : "";
	if (!failed) {
		return `→ tool \`write\`(${path}) — ${lineCount(content)} lines, ${formatBytes(utf8Bytes(content))}; content omitted`;
	}
	const truncated = { ...(args ?? {}) };
	if (typeof truncated.content === "string") truncated.content = truncateResultBody(truncated.content);
	const argsText = renderToolArgs(truncated);
	return argsText ? `→ tool \`write\`:\n${argsText}` : "→ tool `write`";
}

function formatImplementingAgent(
	assistant: AssistantMessage,
	diffByCallId: Map<string, string>,
	failedCallIds: Set<string>,
	argsByCallId: Map<string, Record<string, unknown>>,
): string {
	const sub: string[] = [];
	for (const c of assistant.content) {
		if (c.type === "thinking" && c.thinking?.trim()) {
			sub.push(`<thinking>\n${c.thinking.trim()}\n</thinking>`);
		} else if (c.type === "text" && c.text?.trim()) {
			sub.push(c.text.trim());
		} else if (c.type === "toolCall") {
			const callId = (c as { id?: string }).id;
			if (callId && c.arguments && typeof c.arguments === "object") {
				argsByCallId.set(callId, c.arguments as Record<string, unknown>);
			}
			// When this call produced a diff (a successful edit), suppress the raw
			// {oldText,newText} args and let the result's -/+ diff carry the change: the
			// args are two unannotated peer blobs and the advisor — reviewing AFTER the
			// edit landed (a fresh read shows the NEW side) — can't tell which is on disk
			// ("didn't persist"). With NO diff (failed edit, non-edit tool) show the args
			// verbatim; for a failed edit they're the only evidence of what was attempted.
			const args = c.arguments as Record<string, unknown> | undefined;
			const edits = args?.edits;
			const hasDiff = diffByCallId.has(callId ?? "");
			if (hasDiff && Array.isArray(edits)) {
				const p = typeof args?.path === "string" ? args.path : "?";
				sub.push(`→ tool \`${c.name}\`(${p}) — ${edits.length} block(s); diff in tool result`);
			} else if (c.name === "write") {
				sub.push(formatWriteCall(args, Boolean(callId && failedCallIds.has(callId))));
			} else {
				const argsText = renderToolArgs(args);
				sub.push(argsText ? `→ tool \`${c.name}\`:\n${argsText}` : `→ tool \`${c.name}\``);
			}
		}
	}
	return sub.length ? `#### Implementing agent\n\n${sub.join("\n\n")}` : "";
}

function formatProjectedResults(
	results: readonly ToolResultMessage[],
	argsByCallId: Map<string, Record<string, unknown>>,
): string[] {
	return results.map((tr) => {
		// Prefer the canonical line-numbered unified diff (the same view the human /
		// main model gets, computed by pi's edit-diff) for a SUCCESSFUL result: its -/+
		// markers unambiguously frame removed-vs-current lines, which the flat
		// {oldText,newText} echo lacks. It is also a pinned point-in-time snapshot of
		// THIS turn's change — the advisor's own read returns current (possibly later-
		// edited) disk, so the inline diff is not re-derivable and must ride verbatim.
		// On an ERROR, show the text body instead: the error is the diagnostic, and a
		// diff from a failed edit is untrustworthy (did it apply? partially?).
		const diff = (tr as { details?: { diff?: unknown } }).details?.diff;
		const successfulDiff = !tr.isError && typeof diff === "string" && diff.trim() ? diff : "";
		const rawBody = successfulDiff || textOf(tr.content as Array<{ type: string; text?: string }>);
		const callId = (tr as { toolCallId?: string }).toolCallId;
		const body = successfulDiff
			? successfulDiff
			: formatResultReceipt(tr, rawBody, callId ? argsByCallId.get(callId) : undefined);
		const pointer = callId ? `call: ${callId}` : "";
		const text = [pointer, body || "(no text output)"].filter(Boolean).join("\n");
		return `#### Tool result: \`${tr.toolName}\`${tr.isError ? " (error)" : ""}${exitSuffix(tr)}\n\n${text}`;
	});
}

// Format one primary turn (optionally preceded by the user prompt) as a markdown
// string with REAL newlines throughout (renderToolArgs keeps arg content verbatim).
// The sections are joined with explicit "\n\n" here so the boundary never depends on
// how a provider concatenates content parts — see buildReviewMessages.
export function formatTurnDelta(opts: {
	userPrompt?: string;
	assistant?: AssistantMessage;
	toolResults?: ToolResultMessage[];
}): string {
	const parts: string[] = [];
	if (opts.userPrompt?.trim()) {
		parts.push(`#### User → implementing agent\n\n${opts.userPrompt.trim()}`);
	}

	const results = opts.toolResults ?? [];
	const diffByCallId = indexSuccessfulDiffs(results);
	const failedCallIds = indexFailedCallIds(results);
	const argsByCallId = new Map<string, Record<string, unknown>>();
	if (opts.assistant) {
		const agent = formatImplementingAgent(opts.assistant, diffByCallId, failedCallIds, argsByCallId);
		if (agent) parts.push(agent);
	}
	parts.push(...formatProjectedResults(results, argsByCallId));
	return parts.join("\n\n");
}

export function formatUserBash(message: {
	command?: string;
	output?: string;
	exitCode?: number;
	excludeFromContext?: boolean;
}): string {
	if (message.excludeFromContext) return "";
	const failed = message.exitCode !== 0;
	return `#### User bash\n\n$ ${message.command ?? ""}\n${formatBashReceipt(message.output ?? "", { exitCode: message.exitCode }, failed)}`.trimEnd();
}

function contextText(content: string | Array<{ type: string; text?: string }>): string {
	if (typeof content === "string") return content;
	return content
		.map((part) => (part.type === "text" ? (part.text ?? "") : part.type === "image" ? "[image omitted]" : ""))
		.filter(Boolean)
		.join("\n");
}

/**
 * Render exactly the primary messages Pi currently considers active after applying
 * compaction or branch navigation. This is prior context for the next review, not
 * a historical review request, so advisor messages themselves are excluded.
 */
export function formatActiveSessionContext(entries: readonly SessionEntry[]): string {
	const messages: AgentMessage[] = entries
		.flatMap((entry) => sessionEntryToContextMessages(entry))
		.filter((message) => message.role !== "custom" || message.customType !== ADVISORY_TYPE);
	const parts: string[] = [];

	for (let index = 0; index < messages.length; index++) {
		const message = messages[index];
		if (!message) continue;
		switch (message.role) {
			case "user": {
				const text = contextText(message.content).trim();
				if (text) parts.push(`#### User → implementing agent\n\n${text}`);
				break;
			}
			case "assistant": {
				const toolResults: ToolResultMessage[] = [];
				while (messages[index + 1]?.role === "toolResult") {
					toolResults.push(messages[++index] as ToolResultMessage);
				}
				const delta = formatTurnDelta({ assistant: message, toolResults });
				if (delta) parts.push(delta);
				break;
			}
			case "toolResult": {
				const delta = formatTurnDelta({ toolResults: [message] });
				if (delta) parts.push(delta);
				break;
			}
			case "custom": {
				const text = contextText(message.content).trim();
				if (text) parts.push(`#### Extension context: \`${message.customType}\`\n\n${text}`);
				break;
			}
			case "bashExecution": {
				const bash = formatUserBash(message);
				if (bash) parts.push(bash);
				break;
			}
			case "branchSummary":
				parts.push(`#### Branch summary\n\n${message.summary}`);
				break;
			case "compactionSummary":
				parts.push(`#### Compaction summary\n\n${message.summary}`);
				break;
		}
	}
	return parts.join("\n\n");
}

// Assemble a review prompt as a BATCH of user messages: optional active-session
// context after a history rewrite, then a header/reconfirm turn, then one user
// turn per primary-turn delta. Each message carries exactly ONE text block whose
// internal section separators ("\n\n") are explicit, so nothing depends on how a
// provider joins multiple content parts within a message. Between turns:
// OpenAI-family endpoints (OpenRouter, the default) keep them as distinct turns;
// Anthropic-family folds consecutive user turns into one (\n-joined, per the Messages
// API). Each turn starts with a #### / ### header, so it stays legible either way,
// and arg content rides verbatim (real newlines, no \n-escaping) — the whole point.
export function buildReviewMessages(preamble: string, batch: string[], activeSessionContext?: string): UserMessage[] {
	const now = Date.now();
	const messages: UserMessage[] = [];
	if (activeSessionContext?.trim()) {
		messages.push({
			role: "user",
			content: [
				{
					type: "text",
					text: [
						"### Active session context after history rewrite",
						"",
						"Treat this only as prior context. Review the new activity in the following Session update; do not raise advice solely about this historical context.",
						"",
						activeSessionContext,
					].join("\n"),
				},
			],
			timestamp: now,
		});
	}
	messages.push({
		role: "user",
		content: [{ type: "text", text: `### Session update\n\n${preamble}`.trimEnd() }],
		timestamp: now,
	});
	for (const delta of batch) {
		if (delta.trim()) messages.push({ role: "user", content: [{ type: "text", text: delta }], timestamp: now });
	}
	return messages;
}
