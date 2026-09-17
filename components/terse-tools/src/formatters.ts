import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { EditDiffSummary, ToolStatus } from "./types.js";

const HOME = homedir();
const MAX_PREVIEW_LINES = 20;

const TOOL_NAME_MAP: Record<string, string> = {
	bash: "Bash",
	powershell: "Bash",
	read: "Read",
	edit: "Edit",
	write: "Write",
	grep: "Search",
	find: "Find",
	ls: "Ls",
	task: "ManageTask",
	manage_task: "ManageTask",
	schedule: "Schedule",
	pi_exec: "Exec",
	ask_user_question: "AskUserQuestion",
};

export function formatStatusBullet(status: ToolStatus, theme: Theme): string {
	switch (status) {
		case "running":
			return theme.fg("warning", "●");
		case "error":
			return theme.fg("error", "●");
		case "success":
			return theme.fg("success", "●");
	}
}

export function toPascalCase(name: string): string {
	return name.replace(/[-_](\w)/g, (_, c) => c.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase());
}

export function formatToolName(toolName: string, theme: Theme): string {
	const mapped = TOOL_NAME_MAP[toolName] ?? toPascalCase(toolName);
	const colored = theme.fg("warning", mapped);
	const bolded = theme.bold(colored);
	return bolded.includes("\x1b[1m") ? bolded : `\x1b[1m${bolded}\x1b[22m`;
}

export function formatThoughtHeader(durationMs: number | undefined, tokens: number | undefined, theme: Theme): string {
	const parts: string[] = [];
	if (durationMs !== undefined && durationMs > 0) {
		const sec = Math.max(1, Math.round(durationMs / 1000));
		parts.push(`${sec}s`);
	}
	if (tokens !== undefined && tokens > 0) {
		const tokenStr = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : `${tokens}`;
		parts.push(`${tokenStr} tokens`);
	}
	const meta = parts.length > 0 ? ` for ${parts.join(", ")}` : "";
	return theme.fg("muted", `▶ Thought${meta}`);
}

export function stripAnsi(str: string): string {
	return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export function formatThoughtSnippet(thinkingText: string, width: number, theme: Theme): string {
	const firstLine =
		thinkingText
			.split("\n")
			.map((l) => l.trim())
			.find((l) => l.length > 0) ?? "";
	if (!firstLine) return "";
	const maxLen = Math.max(10, width - 4);
	const snippet = visibleWidth(firstLine) > maxLen ? truncateToWidth(firstLine, maxLen, "...") : firstLine;
	return theme.fg("muted", `  ${snippet}`);
}

export function formatThinkingSpinnerMessage(thinkingText: string, maxWidth = 50): string {
	if (!thinkingText?.trim()) {
		return "Thinking...";
	}

	const lines = thinkingText.split("\n");
	let activeLine = "";
	for (let i = lines.length - 1; i >= 0; i--) {
		const line = lines[i].trim();
		if (line.length > 0) {
			activeLine = line;
			break;
		}
	}

	activeLine = activeLine
		.replace(/^#+\s*/, "")
		.replace(/^[-*•]\s+/, "")
		.replace(/^\d+\.\s+/, "")
		.replace(/[*_]{1,3}([^*_]+)[*_]{1,3}/g, "$1")
		.replace(/`([^`]+)`/g, "$1")
		.replace(/\s+/g, " ")
		.trim();

	if (!activeLine || activeLine.toLowerCase() === "thinking...") {
		return "Thinking...";
	}

	const maxTraceLen = Math.max(10, maxWidth);
	const truncated = activeLine.length > maxTraceLen ? `${activeLine.slice(0, maxTraceLen - 3)}...` : activeLine;

	return `Thinking (${truncated})`;
}

export function formatPath(filePath: string): string {
	if (!filePath) return "";
	if (filePath === HOME) return "~";
	if (filePath.startsWith(`${HOME}/`)) {
		return `~/${filePath.slice(HOME.length + 1)}`;
	}
	return filePath;
}

function formatDefaultArgs(args: Record<string, unknown>): string {
	const keys = [
		"query",
		"command",
		"cmd",
		"path",
		"file",
		"pattern",
		"url",
		"title",
		"name",
		"id",
		"prompt",
		"message",
		"action",
	];
	for (const key of keys) {
		if (typeof args[key] === "string" || typeof args[key] === "number") {
			return String(args[key]);
		}
	}
	const entries = Object.entries(args)
		.filter(([_, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
		.map(([k, v]) => `${k}: ${v}`);
	if (entries.length > 0) {
		const joined = entries.join(", ");
		return joined.length > 80 ? `${joined.slice(0, 77)}...` : joined;
	}
	return "";
}

function formatReadArgs(args: any): string {
	const path = formatPath(args.path || args.file_path || "");
	if (args.offset !== undefined || args.limit !== undefined) {
		const start = args.offset ?? 1;
		const end = args.limit !== undefined ? start + args.limit - 1 : "";
		return `${path}:${start}${end ? `-${end}` : ""}`;
	}
	return path;
}

function formatGrepArgs(args: any): string {
	const pattern = args.pattern ?? "";
	const rawPath = args.path ? formatPath(args.path) : "";
	if (rawPath && rawPath !== ".") {
		return `${pattern} in ${rawPath}`;
	}
	return String(pattern);
}

function formatScheduleArgs(args: any): string {
	const dur =
		args.duration || (args.DurationSeconds ? `${args.DurationSeconds}s` : "") || args.cron || args.CronExpression || "";
	const prompt = args.prompt || args.Prompt || args.message || "";
	return dur ? `${dur}: ${prompt}` : prompt;
}

function formatExecArgs(args: any): string {
	const title = args.title || args.name || args.goal;
	if (title) return String(title);
	if (typeof args.code === "string") {
		const firstLine = args.code.split(/[\r\n]+/)[0]?.trim() || "";
		return firstLine.slice(0, 80);
	}
	return "";
}

export function formatToolArgs(toolName: string, args: any, _cwd?: string): string {
	if (!args || typeof args !== "object") return "";

	switch (toolName) {
		case "bash":
		case "powershell": {
			const cmd = args.command || args.cmd || "";
			return typeof cmd === "string" ? cmd.replace(/[\r\n]+/g, " ").trim() : "";
		}
		case "read":
			return formatReadArgs(args);
		case "edit":
		case "write":
			return formatPath(args.path || args.file_path || "");
		case "grep":
			return formatGrepArgs(args);
		case "find":
			return args.pattern || (args.path ? formatPath(args.path) : ".");
		case "ls":
			return formatPath(args.path || ".");
		case "task":
		case "manage_task": {
			const action = args.action || "";
			const target = args.task_id || args.taskId || "";
			const cmd = args.command || "";
			return [action, target, cmd].filter(Boolean).join(" ");
		}
		case "schedule":
			return formatScheduleArgs(args);
		case "pi_exec":
			return formatExecArgs(args);
		case "ask_user_question":
			return Array.isArray(args.questions) && args.questions[0]
				? args.questions[0].question || args.questions[0].prompt || ""
				: "";
		default:
			return formatDefaultArgs(args);
	}
}

export function parseDiff(diffText: string): EditDiffSummary {
	const rawLines = diffText.split("\n");
	let added = 0;
	let removed = 0;
	const lines: EditDiffSummary["lines"] = [];

	for (const raw of rawLines) {
		if (raw.startsWith("+") && !raw.startsWith("+++")) {
			added++;
			lines.push({ type: "added", content: raw });
		} else if (raw.startsWith("-") && !raw.startsWith("---")) {
			removed++;
			lines.push({ type: "removed", content: raw });
		} else {
			lines.push({ type: "context", content: raw });
		}
	}

	return { added, removed, lines };
}

export function formatCollapsedLine(
	toolName: string,
	args: any,
	status: ToolStatus,
	isLast: boolean,
	theme: Theme,
	cwd?: string,
	width?: number,
): string {
	const bullet = formatStatusBullet(status, theme);
	const name = formatToolName(toolName, theme);
	const hint = isLast ? ` ${theme.fg("muted", "(ctrl+o to expand)")}` : "";
	const argStr = formatToolArgs(toolName, args, cwd);

	if (width !== undefined && width > 0) {
		const prefix = `${bullet} ${name}(`;
		const suffix = `)${hint}`;
		const fixedWidth = visibleWidth(prefix) + visibleWidth(suffix);

		if (fixedWidth >= width) {
			const rawLine = `${prefix}${argStr}${suffix}`;
			return truncateToWidth(rawLine, width, "...");
		}

		const availableArgWidth = width - fixedWidth;
		const truncatedArgs =
			visibleWidth(argStr) > availableArgWidth ? truncateToWidth(argStr, availableArgWidth, "...") : argStr;

		const line = `${prefix}${truncatedArgs}${suffix}`;
		return visibleWidth(line) > width ? truncateToWidth(line, width, "...") : line;
	}

	const line = `${bullet} ${name}(${argStr})`;
	return isLast ? `${line}${hint}` : line;
}

function formatLineListDetail(
	headerLine: string,
	summaryLine: string,
	lines: string[],
	isLast: boolean,
	collapseHint: string,
	width?: number,
): string[] {
	const displayLines = lines.slice(0, MAX_PREVIEW_LINES);
	const detailLines = displayLines.map((line, idx) => {
		const isVeryLast = isLast && idx === displayLines.length - 1 && lines.length <= MAX_PREVIEW_LINES;
		const formatted = `    ${line}${isVeryLast ? collapseHint : ""}`;
		return width !== undefined && width > 0 && visibleWidth(formatted) > width
			? truncateToWidth(formatted, width, "...")
			: formatted;
	});
	if (lines.length > MAX_PREVIEW_LINES) {
		const remaining = lines.length - MAX_PREVIEW_LINES;
		const formatted = `    ... and ${remaining} more lines${isLast ? collapseHint : ""}`;
		detailLines.push(
			width !== undefined && width > 0 && visibleWidth(formatted) > width
				? truncateToWidth(formatted, width, "...")
				: formatted,
		);
	}
	const safeHeader =
		width !== undefined && width > 0 && visibleWidth(headerLine) > width
			? truncateToWidth(headerLine, width, "...")
			: headerLine;
	const safeSummary =
		width !== undefined && width > 0 && visibleWidth(summaryLine) > width
			? truncateToWidth(summaryLine, width, "...")
			: summaryLine;
	return [safeHeader, safeSummary, ...detailLines];
}

function formatEditExpanded(
	headerLine: string,
	args: any,
	result: { details?: any },
	isLast: boolean,
	theme: Theme,
	collapseHint: string,
	width?: number,
): string[] {
	const diffText = result.details?.diff || result.details?.patch || "";
	if (!diffText) {
		const summaryLine = `  └ Successfully edited ${formatPath(args?.path || "")}${isLast ? collapseHint : ""}`;
		const safeHeader =
			width !== undefined && width > 0 && visibleWidth(headerLine) > width
				? truncateToWidth(headerLine, width, "...")
				: headerLine;
		const safeSummary =
			width !== undefined && width > 0 && visibleWidth(summaryLine) > width
				? truncateToWidth(summaryLine, width, "...")
				: summaryLine;
		return [safeHeader, safeSummary];
	}
	const { added, removed, lines } = parseDiff(diffText);
	const summaryLine = `  └ ${theme.fg("toolDiffAdded", `+${added}`)} / ${theme.fg("toolDiffRemoved", `-${removed} lines`)}${lines.length === 0 && isLast ? collapseHint : ""}`;
	const displayLines = lines.slice(0, MAX_PREVIEW_LINES);
	const detailLines = displayLines.map((line, idx) => {
		let styled: string;
		if (line.type === "added") {
			styled = theme.fg("toolDiffAdded", line.content);
		} else if (line.type === "removed") {
			styled = theme.fg("toolDiffRemoved", line.content);
		} else {
			styled = theme.fg("dim", line.content);
		}
		const isVeryLast = isLast && idx === displayLines.length - 1 && lines.length <= MAX_PREVIEW_LINES;
		const formatted = `    ${styled}${isVeryLast ? collapseHint : ""}`;
		return width !== undefined && width > 0 && visibleWidth(formatted) > width
			? truncateToWidth(formatted, width, "...")
			: formatted;
	});
	if (lines.length > MAX_PREVIEW_LINES) {
		const remaining = lines.length - MAX_PREVIEW_LINES;
		const formatted = `    ... and ${remaining} more lines${isLast ? collapseHint : ""}`;
		detailLines.push(
			width !== undefined && width > 0 && visibleWidth(formatted) > width
				? truncateToWidth(formatted, width, "...")
				: formatted,
		);
	}
	const safeHeader =
		width !== undefined && width > 0 && visibleWidth(headerLine) > width
			? truncateToWidth(headerLine, width, "...")
			: headerLine;
	const safeSummary =
		width !== undefined && width > 0 && visibleWidth(summaryLine) > width
			? truncateToWidth(summaryLine, width, "...")
			: summaryLine;
	return [safeHeader, safeSummary, ...detailLines];
}

function formatErrorExpanded(
	headerLine: string,
	result: { content?: Array<{ type: string; text?: string }> },
	isLast: boolean,
	collapseHint: string,
	width?: number,
): string[] {
	const errorText = result.content?.find((c) => c.type === "text")?.text || "Command failed";
	const errorLines = errorText.trim().split("\n");
	const summaryLine = `  └ ${errorLines[0]}${errorLines.length === 1 && isLast ? collapseHint : ""}`;
	const detailLines = errorLines.slice(1, MAX_PREVIEW_LINES).map((line, idx, arr) => {
		const isVeryLast = isLast && idx === arr.length - 1;
		const formatted = `    ${line}${isVeryLast ? collapseHint : ""}`;
		return width !== undefined && width > 0 && visibleWidth(formatted) > width
			? truncateToWidth(formatted, width, "...")
			: formatted;
	});
	const safeHeader =
		width !== undefined && width > 0 && visibleWidth(headerLine) > width
			? truncateToWidth(headerLine, width, "...")
			: headerLine;
	const safeSummary =
		width !== undefined && width > 0 && visibleWidth(summaryLine) > width
			? truncateToWidth(summaryLine, width, "...")
			: summaryLine;
	return [safeHeader, safeSummary, ...detailLines];
}

function formatHeaderLine(bullet: string, name: string, argStr: string, width?: number): string {
	let headerLine = `${bullet} ${name}(${argStr})`;
	if (width !== undefined && width > 0) {
		const prefix = `${bullet} ${name}(`;
		const suffix = ")";
		const fixedWidth = visibleWidth(prefix) + visibleWidth(suffix);
		if (fixedWidth < width) {
			const availableArgWidth = width - fixedWidth;
			const truncatedArgs =
				visibleWidth(argStr) > availableArgWidth ? truncateToWidth(argStr, availableArgWidth, "...") : argStr;
			headerLine = `${prefix}${truncatedArgs}${suffix}`;
		} else {
			headerLine = truncateToWidth(headerLine, width, "...");
		}
	}
	return headerLine;
}

function formatToolSuccessExpanded(
	toolName: string,
	args: any,
	result: { content?: Array<{ type: string; text?: string }>; details?: any },
	headerLine: string,
	isLast: boolean,
	theme: Theme,
	collapseHint: string,
	width?: number,
): string[] {
	const contentText = result.content?.find((c) => c.type === "text")?.text || "";

	switch (toolName) {
		case "edit":
			return formatEditExpanded(headerLine, args, result, isLast, theme, collapseHint, width);

		case "read": {
			const lines = contentText.split("\n");
			const summaryLine = `  └ Read ${lines.length} lines${lines.length === 0 && isLast ? collapseHint : ""}`;
			return formatLineListDetail(headerLine, summaryLine, lines, isLast, collapseHint, width);
		}

		case "write": {
			const lines = contentText.split("\n");
			const summaryLine = `  └ Wrote ${lines.length} lines${lines.length === 0 && isLast ? collapseHint : ""}`;
			return formatLineListDetail(headerLine, summaryLine, lines, isLast, collapseHint, width);
		}

		case "grep": {
			const lines = contentText.trim().split("\n").filter(Boolean);
			const summaryLine = `  └ Found ${lines.length} matches${lines.length === 0 && isLast ? collapseHint : ""}`;
			return formatLineListDetail(headerLine, summaryLine, lines, isLast, collapseHint, width);
		}

		case "find": {
			const lines = contentText.trim().split("\n").filter(Boolean);
			const summaryLine = `  └ Found ${lines.length} files${lines.length === 0 && isLast ? collapseHint : ""}`;
			return formatLineListDetail(headerLine, summaryLine, lines, isLast, collapseHint, width);
		}

		case "ls": {
			const lines = contentText.trim().split("\n").filter(Boolean);
			const summaryLine = `  └ ${lines.length} entries${lines.length === 0 && isLast ? collapseHint : ""}`;
			return formatLineListDetail(headerLine, summaryLine, lines, isLast, collapseHint, width);
		}

		default: {
			if (!contentText.trim()) {
				const summaryLine = `  └ (no output)${isLast ? collapseHint : ""}`;
				const safeHeader =
					width !== undefined && width > 0 && visibleWidth(headerLine) > width
						? truncateToWidth(headerLine, width, "...")
						: headerLine;
				const safeSummary =
					width !== undefined && width > 0 && visibleWidth(summaryLine) > width
						? truncateToWidth(summaryLine, width, "...")
						: summaryLine;
				return [safeHeader, safeSummary];
			}
			const lines = contentText.trim().split("\n");
			const summaryLine = `  └ ${lines[0]}${lines.length === 1 && isLast ? collapseHint : ""}`;
			return formatLineListDetail(headerLine, summaryLine, lines.slice(1), isLast, collapseHint, width);
		}
	}
}

export function formatExpandedLines(
	toolName: string,
	args: any,
	result: { content?: Array<{ type: string; text?: string }>; details?: any; isError?: boolean } | undefined,
	isPartial: boolean,
	isLast: boolean,
	theme: Theme,
	cwd?: string,
	width?: number,
): string[] {
	const status: ToolStatus = isPartial ? "running" : result?.isError ? "error" : "success";
	const bullet = formatStatusBullet(status, theme);
	const name = formatToolName(toolName, theme);
	const argStr = formatToolArgs(toolName, args, cwd);
	const headerLine = formatHeaderLine(bullet, name, argStr, width);

	if (isPartial || !result) {
		const summaryLine = `  └ running...${isLast ? ` ${theme.fg("muted", "(ctrl+o to collapse)")}` : ""}`;
		const safeHeader =
			width !== undefined && width > 0 && visibleWidth(headerLine) > width
				? truncateToWidth(headerLine, width, "...")
				: headerLine;
		const safeSummary =
			width !== undefined && width > 0 && visibleWidth(summaryLine) > width
				? truncateToWidth(summaryLine, width, "...")
				: summaryLine;
		return [safeHeader, safeSummary];
	}

	const collapseHint = ` ${theme.fg("muted", "(ctrl+o to collapse)")}`;

	if (result.isError) {
		return formatErrorExpanded(headerLine, result, isLast, collapseHint, width);
	}

	return formatToolSuccessExpanded(toolName, args, result, headerLine, isLast, theme, collapseHint, width);
}

export function formatCompactionRule(title: string, width: number, theme: Theme): string {
	const safeWidth = Math.max(0, Math.floor(width));
	if (safeWidth <= 0) return "";

	const label = ` ${title} `;
	const labelWidth = visibleWidth(label);
	if (safeWidth <= labelWidth) {
		return theme.fg("dim", truncateToWidth(title, safeWidth, "..."));
	}

	const remaining = safeWidth - labelWidth;
	const leftLen = Math.floor(remaining / 2);
	const rightLen = remaining - leftLen;
	const line = `${"─".repeat(leftLen)}${label}${"─".repeat(rightLen)}`;
	return theme.fg("dim", line);
}

export function formatHorizontalLine(width: number, theme: Theme): string {
	const safeWidth = Math.max(0, Math.floor(width));
	if (safeWidth <= 0) return "";
	return theme.fg("dim", "─".repeat(safeWidth));
}

export function formatCompactionSummary(
	title: string,
	summaryText: string | undefined,
	expanded: boolean,
	width: number,
	theme: Theme,
	markdownTheme?: any,
): string[] {
	const safeWidth = Math.max(0, Math.floor(width));
	if (safeWidth <= 0) return [];

	const headerLine = formatCompactionRule(title, safeWidth, theme);
	if (!expanded) {
		return [headerLine];
	}

	const closingLine = formatHorizontalLine(safeWidth, theme);
	const text = summaryText?.trim() ?? "";
	if (!text) {
		return [headerLine, closingLine];
	}

	const md = new Markdown(text, 1, 0, markdownTheme);
	const rawLines = md.render(safeWidth);
	const summaryLines = rawLines.map((l) => (visibleWidth(l) > safeWidth ? truncateToWidth(l, safeWidth, "...") : l));

	while (summaryLines.length > 0 && summaryLines[0]?.trim() === "") {
		summaryLines.shift();
	}
	while (summaryLines.length > 0 && summaryLines[summaryLines.length - 1]?.trim() === "") {
		summaryLines.pop();
	}

	if (summaryLines.length === 0) {
		return [headerLine, closingLine];
	}

	return [headerLine, "", ...summaryLines, "", closingLine];
}
