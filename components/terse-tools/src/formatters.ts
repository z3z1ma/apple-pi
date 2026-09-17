import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
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
	return theme.fg("accent", theme.bold(mapped));
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
): string {
	const bullet = formatStatusBullet(status, theme);
	const name = formatToolName(toolName, theme);
	const argStr = formatToolArgs(toolName, args, cwd);
	const line = `${bullet} ${name}(${argStr})`;
	if (isLast) {
		return `${line} ${theme.fg("muted", "(ctrl+o to expand)")}`;
	}
	return line;
}

function formatLineListDetail(
	headerLine: string,
	summaryLine: string,
	lines: string[],
	isLast: boolean,
	collapseHint: string,
): string[] {
	const displayLines = lines.slice(0, MAX_PREVIEW_LINES);
	const detailLines = displayLines.map((line, idx) => {
		const isVeryLast = isLast && idx === displayLines.length - 1 && lines.length <= MAX_PREVIEW_LINES;
		return `    ${line}${isVeryLast ? collapseHint : ""}`;
	});
	if (lines.length > MAX_PREVIEW_LINES) {
		const remaining = lines.length - MAX_PREVIEW_LINES;
		detailLines.push(`    ... and ${remaining} more lines${isLast ? collapseHint : ""}`);
	}
	return [headerLine, summaryLine, ...detailLines];
}

function formatEditExpanded(
	headerLine: string,
	args: any,
	result: { details?: any },
	isLast: boolean,
	theme: Theme,
	collapseHint: string,
): string[] {
	const diffText = result.details?.diff || result.details?.patch || "";
	if (!diffText) {
		const summaryLine = `  └ Successfully edited ${formatPath(args?.path || "")}${isLast ? collapseHint : ""}`;
		return [headerLine, summaryLine];
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
		return `    ${styled}${isVeryLast ? collapseHint : ""}`;
	});
	if (lines.length > MAX_PREVIEW_LINES) {
		const remaining = lines.length - MAX_PREVIEW_LINES;
		detailLines.push(`    ... and ${remaining} more lines${isLast ? collapseHint : ""}`);
	}
	return [headerLine, summaryLine, ...detailLines];
}

function formatErrorExpanded(
	headerLine: string,
	result: { content?: Array<{ type: string; text?: string }> },
	isLast: boolean,
	collapseHint: string,
): string[] {
	const errorText = result.content?.find((c) => c.type === "text")?.text || "Command failed";
	const errorLines = errorText.trim().split("\n");
	const summaryLine = `  └ ${errorLines[0]}${errorLines.length === 1 && isLast ? collapseHint : ""}`;
	const detailLines = errorLines.slice(1, MAX_PREVIEW_LINES).map((line, idx, arr) => {
		const isVeryLast = isLast && idx === arr.length - 1;
		return `    ${line}${isVeryLast ? collapseHint : ""}`;
	});
	return [headerLine, summaryLine, ...detailLines];
}

export function formatExpandedLines(
	toolName: string,
	args: any,
	result: { content?: Array<{ type: string; text?: string }>; details?: any; isError?: boolean } | undefined,
	isPartial: boolean,
	isLast: boolean,
	theme: Theme,
	cwd?: string,
): string[] {
	const status: ToolStatus = isPartial ? "running" : result?.isError ? "error" : "success";
	const bullet = formatStatusBullet(status, theme);
	const name = formatToolName(toolName, theme);
	const argStr = formatToolArgs(toolName, args, cwd);
	const headerLine = `${bullet} ${name}(${argStr})`;

	if (isPartial || !result) {
		const summaryLine = `  └ running...${isLast ? ` ${theme.fg("muted", "(ctrl+o to collapse)")}` : ""}`;
		return [headerLine, summaryLine];
	}

	const collapseHint = ` ${theme.fg("muted", "(ctrl+o to collapse)")}`;

	if (result.isError) {
		return formatErrorExpanded(headerLine, result, isLast, collapseHint);
	}

	const contentText = result.content?.find((c) => c.type === "text")?.text || "";

	switch (toolName) {
		case "edit":
			return formatEditExpanded(headerLine, args, result, isLast, theme, collapseHint);

		case "read": {
			const lines = contentText.split("\n");
			const summaryLine = `  └ Read ${lines.length} lines${lines.length === 0 && isLast ? collapseHint : ""}`;
			return formatLineListDetail(headerLine, summaryLine, lines, isLast, collapseHint);
		}

		case "write": {
			const lines = contentText.split("\n");
			const summaryLine = `  └ Wrote ${lines.length} lines${lines.length === 0 && isLast ? collapseHint : ""}`;
			return formatLineListDetail(headerLine, summaryLine, lines, isLast, collapseHint);
		}

		case "grep": {
			const lines = contentText.trim().split("\n").filter(Boolean);
			const summaryLine = `  └ Found ${lines.length} matches${lines.length === 0 && isLast ? collapseHint : ""}`;
			return formatLineListDetail(headerLine, summaryLine, lines, isLast, collapseHint);
		}

		case "find": {
			const lines = contentText.trim().split("\n").filter(Boolean);
			const summaryLine = `  └ Found ${lines.length} files${lines.length === 0 && isLast ? collapseHint : ""}`;
			return formatLineListDetail(headerLine, summaryLine, lines, isLast, collapseHint);
		}

		case "ls": {
			const lines = contentText.trim().split("\n").filter(Boolean);
			const summaryLine = `  └ ${lines.length} entries${lines.length === 0 && isLast ? collapseHint : ""}`;
			return formatLineListDetail(headerLine, summaryLine, lines, isLast, collapseHint);
		}

		default: {
			if (!contentText.trim()) {
				const summaryLine = `  └ (no output)${isLast ? collapseHint : ""}`;
				return [headerLine, summaryLine];
			}
			const lines = contentText.trim().split("\n");
			const summaryLine = `  └ ${lines[0]}${lines.length === 1 && isLast ? collapseHint : ""}`;
			return formatLineListDetail(headerLine, summaryLine, lines.slice(1), isLast, collapseHint);
		}
	}
}
