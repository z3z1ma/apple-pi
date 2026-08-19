import type { SectionData } from "../sections.js";

const section = (title: string, items?: string[]): string => {
	if (!items || items.length === 0) return "";
	const body = items.map((i) => `- ${i}`).join("\n");
	return `[${title}]\n${body}`;
};

const TUI_SAFE_LINE_CHARS = 120;

const wrapLine = (line: string, maxChars: number): string[] => {
	if (line.length <= maxChars) return [line];

	const indent = line.match(/^\s*(?:[-*]\s+|\d+\.\s+)?/)?.[0] ?? "";
	const continuationIndent = indent ? " ".repeat(Math.min(indent.length, 8)) : "";
	const wrapped: string[] = [];
	let remaining = line;
	let prefix = "";

	while (prefix.length + remaining.length > maxChars) {
		const available = Math.max(20, maxChars - prefix.length);
		let splitAt = remaining.lastIndexOf(" ", available);
		if (splitAt < Math.floor(available * 0.5)) splitAt = available;

		wrapped.push(prefix + remaining.slice(0, splitAt).trimEnd());
		remaining = remaining.slice(splitAt).trimStart();
		prefix = continuationIndent;
	}

	if (remaining) wrapped.push(prefix + remaining);
	return wrapped;
};

export const wrapLongLines = (text: string, maxChars = TUI_SAFE_LINE_CHARS): string =>
	text
		.split("\n")
		.flatMap((line) => wrapLine(line, maxChars))
		.join("\n");

/** Format the summary with cache-friendly section ordering.
 *
 * Stable (merged/accumulated) sections come first so the prompt prefix
 * stays cacheable across compactions. Volatile (always-fresh) sections
 * come last. */
export const formatSummary = (data: SectionData): string => {
	// Cache-friendly ordering: stable first, volatile last
	const stableSections = [
		section("Session Goal", data.sessionGoal),
		section("User Preferences", data.userPreferences),
		section("Files And Changes", data.filesAndChanges),
		section("Commits", data.commits),
	].filter(Boolean);

	const volatileSections = [
		section("Type Catalog", data.typeCatalog),
		section("Outstanding Context", data.outstandingContext),
		section("Earlier Turns", data.turnSummaries),
	].filter(Boolean);

	// All header sections (stable + volatile) form the header block
	const allHeaders = [...stableSections, ...volatileSections];

	const parts: string[] = [];
	if (allHeaders.length > 0) {
		parts.push(allHeaders.join("\n\n"));
	}
	if (data.briefTranscript) {
		parts.push(data.briefTranscript);
	}

	if (parts.length === 0) return "";

	// No wrap and no line-cap here. compile() packs to a token budget, then wraps.
	return parts.join("\n\n---\n\n");
};
