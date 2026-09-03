import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { type SessionEntry, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import type { PairReceiptImage, PairReceiptIssuer, PairReceiptSnapshot } from "./receipt-expansion.js";
import {
	formatBashReceipt,
	formatBytes,
	formatResultReceipt,
	lineCount,
	truncateResultBody,
	utf8Bytes,
} from "./receipts.js";
import { isPairQuestion, type PairNote } from "./types.js";

const ADVISORY_TYPE = "advisory";

/** Render held pair notes as the reconfirmation preamble for the next review. */
export function formatReconfirmPreamble(held: readonly PairNote[]): string {
	if (!held.length) return "";
	const items = held
		.map((note) => {
			const id = note.id ? ` id=${note.id}` : "";
			const label = isPairQuestion(note) ? "QUESTION" : (note.severity ?? "nit").toUpperCase();
			return `- [${label}${id}] ${note.note}`;
		})
		.join("\n");
	return [
		"### Things you flagged earlier",
		"",
		"Reconsider these against your partner's latest work.",
		'Call `share_note` again only for items that still matter, passing the exact `id` as `finding_id`. Preserve `kind="question"` for questions; preserve or raise a finding severity as the evidence warrants. Silence withdraws the rest. Keep distinct issues distinct.',
		"",
		items,
		"",
		"---",
		"",
	].join("\n");
}

const PAIR_GUIDANCE = "pause, consider, then use your judgment";
const escapeXml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Render notes as the agent-facing message body: one `<pair-note>` per note.
 * `stale` adds a `context` attribute noting the advice is about an earlier step
 * (used for any finding released at a later nonterminal boundary).
 * `finalAnswer` appends guidance for advice delivered as a followup to a terminal
 * message: at the moment it is steered in, the primary is stopped having returned
 * a final answer this turn — regardless of which turn generated the note. If the
 * The agent acts on it, it should reply with a fresh, self-contained final answer rather
 * than a terse follow-up — so the user reads one complete answer, not a
 * back-and-forth thread it has to stitch together.
 */
export function formatAdvisoryContent(
	notes: readonly PairNote[],
	opts?: { stale?: boolean; finalAnswer?: boolean },
): string {
	const context = opts?.stale ? ` context="raised about an earlier step"` : "";
	const body = notes
		.map((n) => {
			const id = n.id ? ` id="${escapeXml(n.id)}"` : "";
			const kind = isPairQuestion(n) ? ` kind="question"` : "";
			const sev = !isPairQuestion(n) && n.severity ? ` severity="${n.severity}"` : "";
			const source = n.source ? ` source="${n.source}"` : "";
			const disposition = n.adjudication ? ` disposition="${n.adjudication}"` : "";
			return `<pair-note${id}${kind}${sev}${source}${disposition}${context} guidance="${PAIR_GUIDANCE}">\n${escapeXml(n.note)}\n</pair-note>`;
		})
		.join("\n");
	const questionGuidance = notes.some(isPairQuestion)
		? `\n\nIf a pair-note has kind="question", expose the missing evidence in your reasoning or tool actions rather than writing user-facing prose to the pair.`
		: "";
	const rendered = `${body}${questionGuidance}`;
	if (!opts?.finalAnswer) return rendered;
	return `${rendered}\n\nYou had already returned a final answer to the user this turn. If this note changes what you do, respond with a new, self-contained final answer that fully stands on its own — do NOT write a terse follow-up that assumes the user read your previous message. The user should be able to read your new reply alone and get the complete answer.`;
}

// ---- transcript delta formatting (primary turn → markdown for the pair) ----

function textOf(content: Array<{ type: string; text?: string }>): string {
	return content
		.filter((c) => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text as string)
		.join("");
}

// Render any tool-call argument value as readable text with REAL newlines preserved
// at EVERY depth. We never JSON.stringify content: that escapes every real newline
// into a literal backslash-n (so a heredoc body reaches the pair as `<<'EOF'\n...`
// — the exact bug that produced a bogus "garbled markdown" advisory), and escaping
// only at the top level merely pushes the bug into nested strings (e.g. edits[].oldText).
// String leaves ride verbatim; containers are walked. Tool args are plain JSON data
// from the model, so there are no cycles or non-serializable leaves to guard against;
// a depth cap is the only (never-hit-in-practice) backstop.
function renderArgValue(v: unknown, indent: string, depth: number): string {
	// Multiline strings ride raw on following lines — NOT re-indented, which would
	// alter the very content (e.g. a heredoc body) the pair must see verbatim.
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

function receiptImages(content: unknown): PairReceiptImage[] {
	if (!Array.isArray(content)) return [];
	return content.flatMap((part) => {
		if (
			!part ||
			typeof part !== "object" ||
			(part as { type?: unknown }).type !== "image" ||
			typeof (part as { data?: unknown }).data !== "string" ||
			typeof (part as { mimeType?: unknown }).mimeType !== "string"
		) {
			return [];
		}
		return [
			{
				type: "image" as const,
				data: (part as { data: string }).data,
				mimeType: (part as { mimeType: string }).mimeType,
			},
		];
	});
}

function toolReceiptSnapshot(
	tr: ToolResultMessage,
	callId: string,
	args: Record<string, unknown> | undefined,
	rawBody: string,
): PairReceiptSnapshot {
	const argsText = renderToolArgs(args);
	const images = receiptImages(tr.content);
	const text = [
		`Tool call: ${tr.toolName}`,
		`call: ${callId}`,
		argsText ? `Arguments:\n${argsText}` : undefined,
		`Result${tr.isError ? " (error)" : ""}:\n${rawBody || (images.length ? "[image content follows]" : "(no text output)")}`,
	]
		.filter((part): part is string => Boolean(part))
		.join("\n\n");
	return { text, ...(images.length ? { images } : {}) };
}

function toolCallReceiptSnapshot(
	toolName: string,
	callId: string,
	args: Record<string, unknown> | undefined,
): PairReceiptSnapshot {
	const argsText = renderToolArgs(args);
	return {
		text: [`Tool call: ${toolName}`, `call: ${callId}`, argsText ? `Arguments:\n${argsText}` : undefined]
			.filter((part): part is string => Boolean(part))
			.join("\n\n"),
	};
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

function indexResultCallIds(results: readonly ToolResultMessage[]): Set<string> {
	return new Set(
		results.flatMap((result) => {
			const id = (result as { toolCallId?: unknown }).toolCallId;
			return typeof id === "string" && id ? [id] : [];
		}),
	);
}

function indexFailedCallIds(results: readonly ToolResultMessage[]): Set<string> {
	const ids = new Set<string>();
	for (const tr of results) {
		const id = (tr as { toolCallId?: string }).toolCallId;
		if (id && tr.isError) ids.add(id);
	}
	return ids;
}

function formatWriteCall(
	args: Record<string, unknown> | undefined,
	failed: boolean,
	callId: string | undefined,
	hasResult: boolean,
	issueReceipt?: PairReceiptIssuer,
): string {
	const path = typeof args?.path === "string" && args.path ? args.path : "?";
	const content = typeof args?.content === "string" ? args.content : "";
	let text: string;
	let omitted = false;
	if (!failed) {
		const hasContent = typeof args?.content === "string";
		const preview = truncateResultBody(content);
		omitted = hasContent && preview !== content;
		const previewLabel = omitted ? "; content preview truncated" : "";
		const renderedContent = hasContent ? `\ncontent:\n${preview}` : "";
		text = `→ tool \`write\`(${path}) — ${lineCount(content)} lines, ${formatBytes(utf8Bytes(content))}${previewLabel}${renderedContent}`;
	} else {
		const truncated = { ...(args ?? {}) };
		if (typeof truncated.content === "string") {
			truncated.content = truncateResultBody(truncated.content);
			omitted = truncated.content !== content;
		}
		const argsText = renderToolArgs(truncated);
		text = argsText ? `→ tool \`write\`:\n${argsText}` : "→ tool `write`";
	}
	if (!omitted || !callId || hasResult || !issueReceipt) return text;
	const receipt = issueReceipt({
		kind: "tool",
		callId,
		sources: "call",
		snapshot: toolCallReceiptSnapshot("write", callId, args),
	});
	return receipt ? `${text}\nreceipt: ${receipt}` : text;
}

function formatImplementingAgent(
	assistant: AssistantMessage,
	diffByCallId: Map<string, string>,
	failedCallIds: Set<string>,
	resultCallIds: Set<string>,
	argsByCallId: Map<string, Record<string, unknown>>,
	issueReceipt?: PairReceiptIssuer,
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
			// args are two unannotated peer blobs and the pair — reviewing AFTER the
			// edit landed (current checkout state shows the NEW side) — can't tell which persisted
			// ("didn't persist"). With NO diff (failed edit, non-edit tool) show the args
			// verbatim; for a failed edit they're the only evidence of what was attempted.
			const args = c.arguments as Record<string, unknown> | undefined;
			const edits = args?.edits;
			const hasDiff = diffByCallId.has(callId ?? "");
			if (hasDiff && Array.isArray(edits)) {
				const p = typeof args?.path === "string" ? args.path : "?";
				sub.push(`→ tool \`${c.name}\`(${p}) — ${edits.length} block(s); diff in tool result`);
			} else if (c.name === "write") {
				sub.push(
					formatWriteCall(
						args,
						Boolean(callId && failedCallIds.has(callId)),
						callId,
						Boolean(callId && resultCallIds.has(callId)),
						issueReceipt,
					),
				);
			} else {
				const argsText = renderToolArgs(args);
				if (c.name === "acknowledge_pair_findings") {
					sub.push(
						argsText
							? `→ Your partner's feedback on earlier findings:\n${argsText}`
							: "→ Your partner responded to earlier findings.",
					);
				} else {
					sub.push(argsText ? `→ tool \`${c.name}\`:\n${argsText}` : `→ tool \`${c.name}\``);
				}
			}
		}
	}
	return sub.length ? `#### Your partner\n\n${sub.join("\n\n")}` : "";
}

function formatProjectedResults(
	results: readonly ToolResultMessage[],
	argsByCallId: Map<string, Record<string, unknown>>,
	issueReceipt?: PairReceiptIssuer,
): string[] {
	return results.map((tr) => {
		// Prefer the canonical line-numbered unified diff (the same view the human /
		// main model gets, computed by pi's edit-diff) for a SUCCESSFUL result: its -/+
		// markers unambiguously frame removed-vs-current lines, which the flat
		// {oldText,newText} echo lacks. It is also a pinned point-in-time snapshot of
		// THIS turn's change. Current checkout state may already contain later edits,
		// so the inline historical diff is not re-derivable and must ride verbatim.
		// On an ERROR, show the text body instead: the error is the diagnostic, and a
		// diff from a failed edit is untrustworthy (did it apply? partially?).
		const diff = (tr as { details?: { diff?: unknown } }).details?.diff;
		const successfulDiff = !tr.isError && typeof diff === "string" && diff.trim() ? diff : "";
		const rawBody = successfulDiff || textOf(tr.content as Array<{ type: string; text?: string }>);
		const callId = (tr as { toolCallId?: string }).toolCallId;
		const args = callId ? argsByCallId.get(callId) : undefined;
		const body = successfulDiff ? successfulDiff : formatResultReceipt(tr, rawBody, args);
		const omittedResult = !successfulDiff && (body !== rawBody || receiptImages(tr.content).length > 0);
		const writeContent = tr.toolName === "write" && typeof args?.content === "string" ? args.content : undefined;
		const omittedWrite = writeContent !== undefined && truncateResultBody(writeContent) !== writeContent;
		const receipt =
			callId && issueReceipt && (omittedResult || omittedWrite)
				? issueReceipt({
						kind: "tool",
						callId,
						sources: args ? "interaction" : "result",
						snapshot: toolReceiptSnapshot(tr, callId, args, rawBody),
					})
				: undefined;
		const text = [receipt ? `receipt: ${receipt}` : "", body || "(no text output)"].filter(Boolean).join("\n");
		return `#### Tool result: \`${tr.toolName}\`${tr.isError ? " (error)" : ""}${exitSuffix(tr)}\n\n${text}`;
	});
}

// Format one primary turn (optionally preceded by the user prompt) as a markdown
// string with REAL newlines throughout (renderToolArgs keeps arg content verbatim).
// The sections are joined with explicit "\n\n" here so the boundary never depends on
// how a provider concatenates content parts — see buildReviewMessages.
export function formatTurnDelta(opts: {
	userPrompt?: string;
	userMessages?: ReadonlyArray<{ content: unknown; sourceEntryId?: string }>;
	assistant?: AssistantMessage;
	toolResults?: ToolResultMessage[];
	issueReceipt?: PairReceiptIssuer;
}): string {
	const parts: string[] = [];
	if (opts.userMessages?.length) {
		for (const message of opts.userMessages) {
			const text = formatUserMessage(message.content, {
				issueReceipt: opts.issueReceipt,
				sourceEntryId: message.sourceEntryId,
			});
			if (text) parts.push(`#### What the user told your partner\n\n${text}`);
		}
	} else if (opts.userPrompt?.trim()) {
		const text = formatUserMessage(opts.userPrompt);
		if (text) parts.push(`#### What the user told your partner\n\n${text}`);
	}

	const results = opts.toolResults ?? [];
	const diffByCallId = indexSuccessfulDiffs(results);
	const failedCallIds = indexFailedCallIds(results);
	const resultCallIds = indexResultCallIds(results);
	const argsByCallId = new Map<string, Record<string, unknown>>();
	if (opts.assistant) {
		const agent = formatImplementingAgent(
			opts.assistant,
			diffByCallId,
			failedCallIds,
			resultCallIds,
			argsByCallId,
			opts.issueReceipt,
		);
		if (agent) parts.push(agent);
	}
	parts.push(...formatProjectedResults(results, argsByCallId, opts.issueReceipt));
	if (parts.length === 0 && opts.assistant) {
		return `#### Your partner\n\nAssistant turn ended without visible content (stop reason: ${opts.assistant.stopReason ?? "unknown"}).`;
	}
	return parts.join("\n\n");
}

export function formatUserBash(
	message: {
		command?: string;
		output?: string;
		exitCode?: number;
		excludeFromContext?: boolean;
	},
	opts?: { issueReceipt?: PairReceiptIssuer; sourceEntryId?: string },
): string {
	if (message.excludeFromContext) return "";
	const failed = message.exitCode !== 0;
	const output = message.output ?? "";
	const projected = formatBashReceipt(output, { exitCode: message.exitCode }, failed);
	const omitted = output.trim().length > 0 && !projected.endsWith(output.trimEnd());
	const receipt =
		omitted && opts?.issueReceipt && opts.sourceEntryId
			? opts.issueReceipt({
					kind: "bash",
					sourceEntryId: opts.sourceEntryId,
					snapshot: { text: `User bash\n\n$ ${message.command ?? ""}\n${output}`.trimEnd() },
				})
			: undefined;
	return ["#### User bash", "", `$ ${message.command ?? ""}`, receipt ? `receipt: ${receipt}` : "", projected]
		.filter((part, index) => part || index === 1)
		.join("\n")
		.trimEnd();
}

const USER_IMAGE_PLACEHOLDER = "[image]";

function userMessageText(content: unknown): string {
	if (typeof content === "string") return content.trim();
	if (!Array.isArray(content)) return "";
	return content
		.map((part) =>
			part &&
			typeof part === "object" &&
			(part as { type?: unknown }).type === "text" &&
			typeof (part as { text?: unknown }).text === "string"
				? (part as { text: string }).text
				: "",
		)
		.filter((part) => part.length > 0)
		.join("\n")
		.trim();
}

function userMessageReceiptSnapshot(content: unknown, images: readonly PairReceiptImage[]): PairReceiptSnapshot {
	const text = userMessageText(content);
	const follow =
		images.length === 1 ? "1 image follows in original order." : `${images.length} images follow in original order.`;
	return {
		text: ["User message", text || undefined, follow].filter((part): part is string => Boolean(part)).join("\n\n"),
		images,
	};
}

/** Project a user message onto the shared screen: text, compact image placeholders, optional receipt. */
export function formatUserMessage(
	content: unknown,
	opts?: { issueReceipt?: PairReceiptIssuer; sourceEntryId?: string },
): string {
	const images = receiptImages(content);
	const body =
		typeof content === "string"
			? content.trim()
			: Array.isArray(content)
				? content
						.map((part) => {
							if (!part || typeof part !== "object") return "";
							const type = (part as { type?: unknown }).type;
							if (type === "text" && typeof (part as { text?: unknown }).text === "string") {
								return (part as { text: string }).text;
							}
							if (
								type === "image" &&
								typeof (part as { data?: unknown }).data === "string" &&
								typeof (part as { mimeType?: unknown }).mimeType === "string"
							) {
								return USER_IMAGE_PLACEHOLDER;
							}
							return "";
						})
						.filter((part) => part.length > 0)
						.join("\n")
						.trim()
				: "";
	if (!body) return "";
	if (images.length === 0 || !opts?.issueReceipt || !opts.sourceEntryId) return body;
	const receipt = opts.issueReceipt({
		kind: "user",
		sourceEntryId: opts.sourceEntryId,
		snapshot: userMessageReceiptSnapshot(content, images),
	});
	return receipt ? `${body}\nreceipt: ${receipt}` : body;
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
 * a historical review request, so pair messages themselves are excluded.
 */
export function formatActiveSessionContext(entries: readonly SessionEntry[], issueReceipt?: PairReceiptIssuer): string {
	const messages: Array<{ message: AgentMessage; sourceEntryId: string }> = entries.flatMap((entry) =>
		sessionEntryToContextMessages(entry)
			.filter((message) => message.role !== "custom" || message.customType !== ADVISORY_TYPE)
			.map((message) => ({ message, sourceEntryId: entry.id })),
	);
	const parts: string[] = [];

	for (let index = 0; index < messages.length; index++) {
		const item = messages[index];
		const message = item?.message;
		if (!message || !item) continue;
		switch (message.role) {
			case "user": {
				const text = formatUserMessage(message.content, {
					issueReceipt,
					sourceEntryId: item.sourceEntryId,
				});
				if (text) parts.push(`#### What the user told your partner\n\n${text}`);
				break;
			}
			case "assistant": {
				const toolResults: ToolResultMessage[] = [];
				while (messages[index + 1]?.message.role === "toolResult") {
					toolResults.push(messages[++index]!.message as ToolResultMessage);
				}
				const delta = formatTurnDelta({ assistant: message, toolResults, issueReceipt });
				if (delta) parts.push(delta);
				break;
			}
			case "toolResult": {
				const delta = formatTurnDelta({ toolResults: [message], issueReceipt });
				if (delta) parts.push(delta);
				break;
			}
			case "custom": {
				const text = contextText(message.content).trim();
				if (text) parts.push(`#### Extension context: \`${message.customType}\`\n\n${text}`);
				break;
			}
			case "bashExecution": {
				const bash = formatUserBash(message, { issueReceipt, sourceEntryId: item.sourceEntryId });
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
