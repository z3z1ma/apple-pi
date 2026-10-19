// Pi's transcript entries (its session JSONL, as the runtime's `read_entries` returns them) shaped for the conversation
// panel: one entry per message, tool calls kept in their place inside the assistant message, and long text cut. The
// world UI never sees raw entries, so it needs no knowledge of Pi's message format.
import { TRANSCRIPT_TEXT_MAX, type TranscriptEntry, type TranscriptPart } from "../world.js";

/** The custom message type of delivered mail (`components/session-state/src/mail.ts`). */
const MAIL = "apple-pi.mailbox-message";

/** The argument a tool call is known by, in the bridge's order (`components/session-state/src/bridge.ts`). */
const MAIN_ARGS = ["command", "path", "pattern", "query", "description", "task", "name", "code"];

function mainArg(args: unknown): string | null {
	if (!args || typeof args !== "object") return null;
	for (const key of MAIN_ARGS) {
		const value = (args as Record<string, unknown>)[key];
		if (typeof value === "string" && value.trim()) return value.trim().split("\n")[0];
	}
	return null;
}

function cut(text: string): { text: string; cut: boolean } {
	return text.length > TRANSCRIPT_TEXT_MAX
		? { text: text.slice(0, TRANSCRIPT_TEXT_MAX), cut: true }
		: { text, cut: false };
}

const clip = (text: string) => cut(text).text;

/** The text of a message's content (a string, or text and image parts), and how many images it holds. */
function contentOf(content: unknown): { text: string; images: number } {
	if (typeof content === "string") return { text: content, images: 0 };
	const texts: string[] = [];
	let images = 0;
	for (const part of Array.isArray(content) ? content : []) {
		if (part?.type === "text" && typeof part.text === "string") texts.push(part.text);
		else if (part?.type === "image") images++;
	}
	return { text: texts.join("\n"), images };
}

/** The mail's body: from its details, else the text inside the `<mailbox-message>` wrapper. */
function mailOf(entry: Record<string, unknown>): { from: string; text: string } {
	const details = entry.details as { from?: unknown; body?: unknown } | undefined;
	const raw = contentOf(entry.content).text;
	const from = typeof details?.from === "string" ? details.from : (/from="([^"]*)"/.exec(raw)?.[1] ?? "someone");
	const body =
		typeof details?.body === "string"
			? details.body
			: raw.replace(/^\s*<mailbox-message[^>]*>\n?/, "").replace(/\n?<\/mailbox-message>\s*$/, "");
	return { from, text: clip(body) };
}

function partsOf(content: unknown): TranscriptPart[] {
	const parts: TranscriptPart[] = [];
	for (const part of Array.isArray(content) ? content : []) {
		if (part?.type === "text" && typeof part.text === "string" && part.text.trim())
			parts.push({ kind: "text", text: clip(part.text) });
		else if (part?.type === "thinking" && typeof part.thinking === "string" && (part.thinking.trim() || part.redacted))
			parts.push({ kind: "thinking", text: part.redacted ? "" : clip(part.thinking) });
		else if (part?.type === "toolCall" && typeof part.name === "string")
			parts.push({
				kind: "tool",
				call: {
					id: String(part.id ?? ""),
					name: part.name,
					arg: mainArg(part.arguments),
					input: clip(JSON.stringify(part.arguments ?? {}, null, 2)),
				},
			});
	}
	return parts;
}

/** One transcript entry for the panel; undefined for entries it does not show. */
export function transcriptEntry(raw: unknown): TranscriptEntry | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const entry = raw as Record<string, unknown>;
	const id = String(entry.id ?? "");
	const at = Date.parse(String(entry.timestamp ?? "")) || 0;
	if (entry.type === "custom_message") {
		const label = String(entry.customType ?? "message");
		if (label === MAIL) return { kind: "mail", id, at, ...mailOf(entry) };
		return { kind: "note", id, at, label, text: clip(contentOf(entry.content).text), shown: entry.display !== false };
	}
	if (entry.type !== "message") return undefined;
	const message = entry.message as Record<string, unknown> | undefined;
	if (message?.role === "user") {
		const { text, images } = contentOf(message.content);
		return { kind: "user", id, at, text: clip(text), images };
	}
	if (message?.role === "assistant")
		return {
			kind: "assistant",
			id,
			at,
			parts: partsOf(message.content),
			error: message.stopReason === "error" ? String(message.errorMessage ?? "The reply failed.") : null,
			aborted: message.stopReason === "aborted",
		};
	if (message?.role === "toolResult") {
		const { text, images } = contentOf(message.content);
		const shown = cut(
			images ? `${text}${text ? "\n" : ""}${images === 1 ? "[an image]" : `[${images} images]`}` : text,
		);
		return {
			kind: "tool-result",
			id,
			at,
			callId: String(message.toolCallId ?? ""),
			tool: String(message.toolName ?? "tool"),
			text: shown.text,
			isError: message.isError === true,
			cut: shown.cut,
		};
	}
	return undefined;
}
