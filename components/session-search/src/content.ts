import type { Message } from "@earendil-works/pi-ai";

export const estimateTextTokens = (text: string): number => Math.ceil(text.length / 4);

export const clip = (text: string, max = 200): string => {
	if (text.length <= max) return text;
	const cut = text.lastIndexOf(" ", max);
	let end = cut > max * 0.6 ? cut : max;
	if (end > 0 && end < text.length) {
		const code = text.charCodeAt(end - 1);
		if (code >= 0xd800 && code <= 0xdbff) end--;
	}
	return text.slice(0, end);
};

export const clipSentence = (text: string, max = 200): string => {
	if (text.length <= max) return text;
	const window = text.slice(0, max);
	const matches = [...window.matchAll(/[.!?](?:\s|$)/g)];
	if (matches.length > 0) {
		const last = matches[matches.length - 1];
		const end = (last.index ?? 0) + 1;
		if (end >= max * 0.5) return text.slice(0, end);
	}
	return clip(text, max);
};

export const nonEmptyLines = (text: string): string[] =>
	text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);

export const firstLine = (text: string, max = 200): string => clip(text.split("\n")[0] ?? "", max);

const textParts = (content: Message["content"]): string[] => {
	if (!content) return [];
	if (typeof content === "string") return [content];
	return content.filter((part) => part.type === "text").map((part) => part.text);
};

export const textOf = (content: Message["content"]): string => textParts(content).join("\n");

const thinkingParts = (content: Message["content"]): string[] => {
	if (!content) return [];
	if (typeof content === "string") return [];
	return content.filter((part) => part.type === "thinking").map((part) => part.thinking ?? "");
};

export const thinkingOf = (content: Message["content"]): string => thinkingParts(content).join("\n");

const toolCallArgText = (args: Record<string, unknown>): string => {
	const vals: string[] = [];
	for (const v of Object.values(args ?? {})) {
		if (typeof v === "string" && v.length > 0) vals.push(v);
	}
	if (isContentBearing(args) && Array.isArray(args.edits)) vals.push(contentBearingText(args));
	return vals.join("\n");
};

const toolCallParts = (content: Message["content"]): string[] => {
	if (!content || typeof content === "string") return [];
	return content.filter((part) => part.type === "toolCall").map((part) => toolCallArgText(part.arguments));
};

export const toolCallsOf = (content: Message["content"]): string => toolCallParts(content).filter(Boolean).join("\n");

const CONTENT_PATH_KEYS = ["path", "file_path", "filePath", "file"] as const;

export const isContentBearing = (args: Record<string, unknown>): boolean => {
	if (!CONTENT_PATH_KEYS.some((key) => typeof args[key] === "string")) return false;
	if (typeof args.content === "string" && args.content.length > 0) return true;
	if (Array.isArray(args.edits) && args.edits.length > 0) {
		return args.edits.some(
			(edit) =>
				Boolean(edit) &&
				typeof edit === "object" &&
				(typeof (edit as any).oldText === "string" || typeof (edit as any).newText === "string"),
		);
	}
	return typeof args.oldText === "string" || typeof args.newText === "string";
};

export const contentBearingText = (args: Record<string, unknown>): string => {
	const parts: string[] = [];
	if (typeof args.content === "string") parts.push(args.content);
	if (Array.isArray(args.edits)) {
		for (const edit of args.edits) {
			if (!edit || typeof edit !== "object") continue;
			if (typeof (edit as any).oldText === "string") parts.push((edit as any).oldText);
			if (typeof (edit as any).newText === "string") parts.push((edit as any).newText);
		}
	} else {
		if (typeof args.oldText === "string") parts.push(args.oldText);
		if (typeof args.newText === "string") parts.push(args.newText);
	}
	return parts.join("\n");
};

const _snippet = (text: string, term: string, radius = 60): string | null => {
	const idx = text.toLowerCase().indexOf(term.toLowerCase());
	if (idx === -1) return null;
	const start = Math.max(0, idx - radius);
	const end = Math.min(text.length, idx + term.length + radius);
	const prefix = start > 0 ? "..." : "";
	const suffix = end < text.length ? "..." : "";
	return `${prefix}${text.slice(start, end)}${suffix}`;
};
