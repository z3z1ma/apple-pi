import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import { type SessionEntry, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { MAIL_CUSTOM_TYPE } from "../../session-state/src/mail.js";
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

export function mailFromEntry(entry: unknown): string | undefined {
	if (!entry || typeof entry !== "object") return undefined;
	const message = entry as { type?: string; customType?: string; content?: unknown };
	return message.type === "custom_message" &&
		message.customType === MAIL_CUSTOM_TYPE &&
		typeof message.content === "string"
		? message.content
		: undefined;
}

export function formatIncomingMail(content: string): string {
	return `#### Mail received by your partner\n\n${content}`;
}

const ADVISORY_TYPE = "advisory";

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

function textOf(content: Array<{ type: string; text?: string }>): string {
	return content
		.filter((c) => c.type === "text" && typeof c.text === "string")
		.map((c) => c.text as string)
		.join("");
}

function renderArgValue(v: unknown, indent: string, depth: number): string {
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

export function formatTurnDelta(opts: {
	userPrompt?: string;
	userMessages?: ReadonlyArray<{ content: unknown; sourceEntryId?: string; kind?: "mail" }>;
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
			if (text)
				parts.push(
					message.kind === "mail" ? formatIncomingMail(text) : `#### What the user told your partner\n\n${text}`,
				);
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
