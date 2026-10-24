import {
	type BashToolDetails,
	type FindToolDetails,
	type GrepToolDetails,
	getLanguageFromPath,
	highlightCode,
	type LsToolDetails,
	renderDiff,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

export function outputTextLines(text: string, theme: Theme, color: "toolOutput" | "error" = "toolOutput"): string[] {
	const normalized = text.replace(/\t/g, "   ");
	const width = normalized.split(/\r\n|\r|\n/).reduce((max, line) => Math.max(max, visibleWidth(line)), 1);
	// Carry command styles across literal newlines before the UI adds its own colors and borders.
	return wrapTextWithAnsi(normalized, width).map((line) =>
		theme.fg(color, /\x1b\[[0-9;:]*m/.test(line) ? `${line}\x1b[0m` : line),
	);
}

export function fileTextLines(text: string, args: unknown, theme: Theme): string[] {
	const path = args && typeof args === "object" ? ((args as any).file_path ?? (args as any).path) : undefined;
	const language = typeof path === "string" ? getLanguageFromPath(path) : undefined;
	const normalized = text.replace(/\t/g, "   ");
	return language ? highlightCode(normalized, language) : outputTextLines(normalized, theme);
}

export function outputWarningLines(details: unknown, theme: Theme): string[] {
	if (!details || typeof details !== "object") return [];
	const metadata = details as Partial<BashToolDetails & GrepToolDetails & FindToolDetails & LsToolDetails>;
	const warnings: string[] = [];
	if (metadata.truncation?.truncated) warnings.push("Output truncated");
	if (metadata.matchLimitReached) warnings.push(`${metadata.matchLimitReached} matches limit`);
	if (metadata.resultLimitReached) warnings.push(`${metadata.resultLimitReached} results limit`);
	if (metadata.entryLimitReached) warnings.push(`${metadata.entryLimitReached} entries limit`);
	if (metadata.linesTruncated) warnings.push("Some lines truncated");
	if (metadata.fullOutputPath) warnings.push(`Full output: ${metadata.fullOutputPath}`);
	return warnings.map((warning) => theme.fg("warning", `[${warning}]`));
}

export function diffLines(text: string, theme: Theme): string[] {
	// Pi's edit diffs carry line numbers; other tools can return ordinary unified patches.
	if (/^[+-]\s*\d+ /m.test(text)) return renderDiff(text).split("\n");
	return text
		.split("\n")
		.map((line) =>
			theme.fg(
				line.startsWith("+") ? "toolDiffAdded" : line.startsWith("-") ? "toolDiffRemoved" : "toolDiffContext",
				line,
			),
		);
}
