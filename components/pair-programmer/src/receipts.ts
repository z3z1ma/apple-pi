import type { ToolResultMessage } from "@earendil-works/pi-ai";

export const RESULT_LINE_CAP = 40;
export const RESULT_CHAR_CAP = 2000;
export const PATH_NAME_CAP = 20;
export const BASH_TAIL_LINES = 20;
export const BASH_TAIL_CHARS = 1500;

export type ToolArgs = Record<string, unknown> | undefined;

type Truncation = {
	truncated?: boolean;
	truncatedBy?: string | null;
	outputLines?: number;
	totalLines?: number;
	outputBytes?: number;
	totalBytes?: number;
};

type ResultDetails = {
	matchLimitReached?: unknown;
	resultLimitReached?: unknown;
	entryLimitReached?: unknown;
	linesTruncated?: unknown;
	truncation?: Truncation;
};

const GREP_MATCH = /^(.+?):(\d+):\s/;
const SHOWING_RANGE = /Showing lines (\d+)-(\d+) of (\d+)/;
const NOTICE_LINE = /^\[[\s\S]*\]$/;

function asDetails(value: unknown): ResultDetails {
	if (!value || typeof value !== "object") return {};
	return value as ResultDetails;
}

export function utf8Bytes(text: string): number {
	return new TextEncoder().encode(text).length;
}

export function lineCount(text: string): number {
	if (!text) return 0;
	const lines = text.split("\n");
	if (text.endsWith("\n")) lines.pop();
	return lines.length;
}

export function formatBytes(n: number): string {
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function contentLines(body: string): string[] {
	return body.split("\n").filter((line) => {
		const trimmed = line.trim();
		return trimmed.length > 0 && !NOTICE_LINE.test(trimmed);
	});
}

function stripTrailingNotice(body: string): string {
	return body.replace(/\n\n\[[\s\S]*\]\s*$/, "").trimEnd();
}

function flagLines(details: ResultDetails): string[] {
	const flags: string[] = [];
	if (typeof details.matchLimitReached === "number") {
		flags.push(`truncated: ${details.matchLimitReached} match limit`);
	}
	if (typeof details.resultLimitReached === "number") {
		flags.push(`truncated: ${details.resultLimitReached} result limit`);
	}
	if (typeof details.entryLimitReached === "number") {
		flags.push(`truncated: ${details.entryLimitReached} entry limit`);
	}
	if (details.linesTruncated === true) flags.push("truncated: long match lines");
	const truncation = details.truncation;
	if (truncation?.truncated) {
		if (truncation.truncatedBy === "lines" && truncation.outputLines != null && truncation.totalLines != null) {
			flags.push(`truncated: ${truncation.outputLines} of ${truncation.totalLines} lines`);
		} else if (truncation.truncatedBy === "bytes") {
			flags.push("truncated: byte limit");
		} else {
			flags.push("truncated");
		}
	}
	return flags;
}

export function truncateResultBody(body: string): string {
	if (lineCount(body) <= RESULT_LINE_CAP && body.length <= RESULT_CHAR_CAP) return body;
	const marker = "… truncated";
	const maxContentLines = RESULT_LINE_CAP - 1;
	const maxContentChars = RESULT_CHAR_CAP - marker.length - 1;
	let out = body.split("\n").slice(0, maxContentLines).join("\n").slice(0, maxContentChars);
	if (/[\uD800-\uDBFF]$/.test(out)) out = out.slice(0, -1);
	return out ? `${out}\n${marker}` : marker;
}

function requestedRange(args: ToolArgs): string | undefined {
	if (!args) return undefined;
	const offset = typeof args.offset === "number" ? args.offset : undefined;
	const limit = typeof args.limit === "number" ? args.limit : undefined;
	if (offset === undefined && limit === undefined) return undefined;
	const start = offset ?? 1;
	if (limit === undefined) return `${start}–end`;
	return `${start}–${start + limit - 1}`;
}

function returnedRange(
	body: string,
	args: ToolArgs,
	details: ResultDetails,
	returnedLines: number,
): string | undefined {
	const shown = SHOWING_RANGE.exec(body);
	if (shown) return `${shown[1]}–${shown[2]} of ${shown[3]}`;
	const truncation = details.truncation;
	const start = typeof args?.offset === "number" ? args.offset : 1;
	if (truncation?.truncated && truncation.outputLines != null && truncation.totalLines != null) {
		return `${start}–${start + truncation.outputLines - 1} of ${truncation.totalLines}`;
	}
	if (typeof args?.offset === "number" || typeof args?.limit === "number") {
		return `${start}–${start + returnedLines - 1}`;
	}
	return undefined;
}

function formatReadReceipt(body: string, details: ResultDetails, args: ToolArgs): string {
	const trimmed = body.trim();
	if (trimmed.startsWith("Read image file")) {
		return trimmed.split("\n")[0] ?? trimmed;
	}
	const payload = stripTrailingNotice(body);
	const returnedLines = details.truncation?.outputLines ?? lineCount(payload);
	const returnedBytes = details.truncation?.outputBytes ?? utf8Bytes(payload);
	const parts: string[] = [];
	const requested = requestedRange(args);
	if (requested) parts.push(`requested ${requested}`);
	const returned = returnedRange(body, args, details, returnedLines);
	if (returned) parts.push(`returned ${returned}`);
	parts.push(`${returnedLines} lines, ${formatBytes(returnedBytes)}`);
	parts.push(...flagLines(details));
	return parts.join("\n");
}

function formatGrepReceipt(body: string, details: ResultDetails): string {
	const trimmed = body.trim();
	if (trimmed === "No matches found") return trimmed;
	const byFile = new Map<string, number[]>();
	for (const line of contentLines(body)) {
		const match = GREP_MATCH.exec(line);
		if (!match) continue;
		const file = match[1];
		const lineNo = Number(match[2]);
		if (!file || !Number.isFinite(lineNo)) continue;
		const list = byFile.get(file);
		if (list) list.push(lineNo);
		else byFile.set(file, [lineNo]);
	}
	if (byFile.size === 0) {
		return [`${lineCount(stripTrailingNotice(body))} lines`, ...flagLines(details)].join("\n");
	}
	let matches = 0;
	const loci: string[] = [];
	for (const [file, nums] of byFile) {
		matches += nums.length;
		loci.push(`${file}: ${nums.join(", ")}`);
	}
	return [
		`${matches} match${matches === 1 ? "" : "es"} in ${byFile.size} file${byFile.size === 1 ? "" : "s"}`,
		...loci,
		...flagLines(details),
	].join("\n");
}

function formatNameListReceipt(body: string, details: ResultDetails, noun: "path" | "entry"): string {
	const trimmed = body.trim();
	if (trimmed === "No files found matching pattern" || trimmed === "(empty directory)") return trimmed;
	const names = contentLines(body);
	const shown = names.slice(0, PATH_NAME_CAP);
	const parts = [`${names.length} ${noun}${names.length === 1 ? "" : "s"}`, ...shown];
	if (names.length > PATH_NAME_CAP) parts.push(`shown ${PATH_NAME_CAP} of ${names.length}`);
	parts.push(...flagLines(details));
	return parts.join("\n");
}

export function formatBashReceipt(body: string, details: unknown, isError: boolean): string {
	const parsed = asDetails(details);
	const payload = stripTrailingNotice(body);
	const empty = payload === "" || payload === "(no output)";
	const lines = empty ? 0 : lineCount(payload);
	const bytes = empty ? 0 : utf8Bytes(payload);
	const parts = [`${lines} lines, ${formatBytes(bytes)}`, ...flagLines(parsed)];
	if (isError) {
		const tail = failureTail(payload);
		if (tail) parts.push("", tail);
	}
	return parts.join("\n");
}

function failureTail(body: string): string {
	if (!body || body === "(no output)") return "";
	if (lineCount(body) <= BASH_TAIL_LINES && body.length <= BASH_TAIL_CHARS) return body;
	const lines = body.split("\n");
	if (body.endsWith("\n")) lines.pop();
	let out = "";
	for (let i = lines.length - 1; i >= 0; i--) {
		const next = out ? `${lines[i]}\n${out}` : lines[i];
		if (lineCount(next) > BASH_TAIL_LINES || next.length > BASH_TAIL_CHARS) break;
		out = next ?? "";
	}
	return out ? `… tail\n${out}` : "";
}

export function formatResultReceipt(tr: ToolResultMessage, rawBody: string, args?: ToolArgs): string {
	if (tr.isError && tr.toolName !== "bash") return truncateResultBody(rawBody);
	const details = asDetails((tr as { details?: unknown }).details);
	switch (tr.toolName) {
		case "read":
			return formatReadReceipt(rawBody, details, args);
		case "grep":
			return formatGrepReceipt(rawBody, details);
		case "find":
			return formatNameListReceipt(rawBody, details, "path");
		case "ls":
			return formatNameListReceipt(rawBody, details, "entry");
		case "bash":
			return formatBashReceipt(rawBody, details, Boolean(tr.isError));
		default:
			return truncateResultBody(rawBody);
	}
}
