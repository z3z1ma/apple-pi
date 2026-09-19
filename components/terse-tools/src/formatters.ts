import { homedir } from "node:os";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Markdown, type MarkdownTheme, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
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
	monitor: "Monitor",
	pi_exec: "Exec",
	ask_user_question: "AskUserQuestion",
};

export function formatStatusBullet(status: ToolStatus, theme: Theme, isRtk = false): string {
	const symbol = isRtk ? "▲" : "●";
	switch (status) {
		case "running":
			return theme.fg("warning", symbol);
		case "error":
			return theme.fg("error", symbol);
		case "success":
			return theme.fg("success", symbol);
	}
}

export function toPascalCase(name: string): string {
	return name.replace(/[-_]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase()).replace(/^\w/, (c) => c.toUpperCase());
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
	return str.replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
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

function summarizeObject(obj: Record<string, unknown>): string {
	const preferredKeys = [
		"content",
		"question",
		"prompt",
		"message",
		"title",
		"name",
		"description",
		"reason",
		"pattern",
		"command",
		"cmd",
		"path",
		"file",
		"id",
		"target",
		"task",
	];

	if (typeof obj.disposition === "string") {
		const id = obj.id ? ` ${obj.id}` : "";
		const reason = obj.reason
			? `: ${String(obj.reason)
					.replace(/[\r\n]+/g, " ")
					.trim()}`
			: "";
		return `${obj.disposition}${id}${reason}`;
	}

	for (const key of preferredKeys) {
		const v = obj[key];
		if (typeof v === "string" || typeof v === "number") {
			return String(v)
				.replace(/[\r\n]+/g, " ")
				.trim();
		}
	}

	const parts = Object.entries(obj)
		.filter(([_, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")
		.map(([k, v]) => `${k}: ${v}`);
	return parts.join(", ");
}

function summarizeArray(arr: unknown[]): string {
	if (arr.length === 0) return "";
	const first = arr[0];
	let summary = "";

	if (typeof first === "string" || typeof first === "number" || typeof first === "boolean") {
		if (arr.every((item) => typeof item === "string" || typeof item === "number")) {
			return (arr as (string | number)[]).join(", ");
		}
		summary = String(first);
	} else if (first && typeof first === "object") {
		summary = summarizeObject(first as Record<string, unknown>);
	}

	if (!summary) return "";
	if (arr.length > 1) {
		return `${summary} (+${arr.length - 1} more)`;
	}
	return summary;
}

function formatDefaultArgs(args: Record<string, unknown>): string {
	const priorityKeys = [
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
		"question",
		"questions",
		"reflections",
		"findings",
		"target",
		"task",
		"agent_id",
		"tool",
		"prompt",
		"message",
		"action",
	];
	for (const key of priorityKeys) {
		const val = args[key];
		if (typeof val === "string" || typeof val === "number") {
			return String(val)
				.replace(/[\r\n]+/g, " ")
				.trim();
		}
		if (Array.isArray(val) && val.length > 0) {
			const arrSummary = summarizeArray(val);
			if (arrSummary) return arrSummary;
		}
	}
	const entries: string[] = [];
	for (const [k, v] of Object.entries(args)) {
		if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
			entries.push(`${k}: ${v}`);
		} else if (Array.isArray(v) && v.length > 0) {
			const arrSummary = summarizeArray(v);
			if (arrSummary) {
				entries.push(`${k}: ${arrSummary}`);
			}
		} else if (v && typeof v === "object" && Object.keys(v).length > 0) {
			const objSummary = summarizeObject(v as Record<string, unknown>);
			if (objSummary) {
				entries.push(`${k}: ${objSummary}`);
			}
		}
	}
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
		(args.delay_seconds !== undefined ? `${args.delay_seconds}s` : "") ||
		args.duration ||
		(args.DurationSeconds ? `${args.DurationSeconds}s` : "") ||
		args.cron ||
		args.CronExpression ||
		"";
	const work = args.prompt || args.Prompt || args.message || args.command || "";
	return dur ? `${dur}: ${work}` : work;
}

function formatExecArgs(args: any): string {
	const title = args.display?.name || args.display?.description || args.title || args.name || args.goal;
	if (title) return String(title);
	if (typeof args.code === "string") {
		const firstLine = args.code.split(/[\r\n]+/)[0]?.trim() || "";
		return firstLine.slice(0, 80);
	}
	return "";
}

function formatUpdateNotebookArgs(args: any): string {
	if (Array.isArray(args.reflections) && args.reflections.length > 0) {
		const first = String(args.reflections[0]?.content || "")
			.replace(/[\r\n]+/g, " ")
			.trim();
		const more = args.reflections.length > 1 ? ` (+${args.reflections.length - 1} more)` : "";
		const retire =
			Array.isArray(args.retireReflectionIds) && args.retireReflectionIds.length > 0
				? ` (retire: ${args.retireReflectionIds.length})`
				: "";
		return `${first}${more}${retire}`;
	}
	if (Array.isArray(args.retireReflectionIds) && args.retireReflectionIds.length > 0) {
		return `retire: ${args.retireReflectionIds.join(", ")}`;
	}
	if (Array.isArray(args.retainReflectionIds) && args.retainReflectionIds.length > 0) {
		return `retain: ${args.retainReflectionIds.length}`;
	}
	return "";
}

function formatAcknowledgeFindingsArgs(args: any): string {
	if (!Array.isArray(args.findings) || args.findings.length === 0) return "";
	if (args.findings.length === 1) {
		const f = args.findings[0];
		const id = f.id || "";
		const disp = f.disposition || "";
		const reason = (f.reason || "").replace(/[\r\n]+/g, " ").trim();
		if (disp && id && reason) return `${disp} ${id}: ${reason}`;
		if (disp && id) return `${disp} ${id}`;
		if (disp && reason) return `${disp}: ${reason}`;
		return disp || id || reason;
	}
	return args.findings
		.map((f: any) => {
			const id = f.id || "";
			const disp = f.disposition || "";
			return id ? `${disp} ${id}` : disp;
		})
		.filter(Boolean)
		.join(", ");
}

function formatAgentArgs(args: any): string {
	const type = args.subagent_type || args.type || "";
	const desc =
		args.description || (typeof args.prompt === "string" ? args.prompt.split(/[\r\n]+/)[0]?.trim() : "") || "";
	const bg = args.run_in_background ? " (bg)" : "";
	if (type && desc) return `${type}${bg}: ${desc}`;
	if (type) return `${type}${bg}`;
	return desc;
}

function formatSubagentArgs(args: any): string {
	const id = args.agent_id || args.id || "";
	if (args.message) {
		const msg = String(args.message)
			.replace(/[\r\n]+/g, " ")
			.trim();
		return id ? `${id}: ${msg}` : msg;
	}
	return String(id);
}

function formatSearchSessionArgs(args: any): string {
	if (args.query) {
		const mode = args.mode && args.mode !== "history" ? ` (${args.mode})` : "";
		return `${args.query}${mode}`;
	}
	if (args.mode) {
		return `mode: ${args.mode}`;
	}
	if (Array.isArray(args.expand) && args.expand.length > 0) {
		return `expand: ${args.expand.join(", ")}`;
	}
	return "";
}

function formatLedgerCloseArgs(args: any): string {
	const task = args.task || "";
	const status = args.status || "";
	if (task && status) return `${status} ${task}`;
	return task || status;
}

function formatWikiReferencesArgs(args: any): string {
	const target = args.target || "";
	const extras = [
		args.direction && args.direction !== "both" ? args.direction : "",
		args.depth && args.depth > 1 ? `depth ${args.depth}` : "",
	].filter(Boolean);
	return extras.length > 0 ? `${target} (${extras.join(", ")})` : target;
}

function formatMcpArgs(args: any): string {
	if (args.tool) {
		const server = args.server ? `${args.server}/` : "";
		const inner = args.args && typeof args.args === "object" ? formatDefaultArgs(args.args) : "";
		return `${server}${args.tool}${inner ? `(${inner})` : ""}`;
	}
	if (args.search) return `search: ${args.search}`;
	if (args.describe) return `describe: ${args.describe}`;
	if (args.connect) return `connect: ${args.connect}`;
	if (args.action) return `${args.action}${args.url ? ` ${args.url}` : ""}`;
	return formatDefaultArgs(args);
}

export function formatToolArgs(toolName: string, args: any, _cwd?: string): string {
	if (!args || typeof args !== "object") return "";

	if (toolName.startsWith("mcp__")) {
		return formatMcpArgs(args);
	}

	switch (toolName) {
		case "bash":
		case "powershell":
		case "monitor": {
			const cmd = args._rawCommand || args.command || args.cmd || "";
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
				? String(args.questions[0].question || args.questions[0].prompt || "")
						.replace(/[\r\n]+/g, " ")
						.trim()
				: "";
		case "update_notebook":
			return formatUpdateNotebookArgs(args);
		case "acknowledge_pair_findings":
			return formatAcknowledgeFindingsArgs(args);
		case "agent":
			return formatAgentArgs(args);
		case "get_subagent_result":
		case "steer_subagent":
		case "stop_subagent":
			return formatSubagentArgs(args);
		case "search_session":
			return formatSearchSessionArgs(args);
		case "ledger_close":
			return formatLedgerCloseArgs(args);
		case "wiki_references":
			return formatWikiReferencesArgs(args);
		case "mcp":
			return formatMcpArgs(args);
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
	isRtk = false,
): string {
	const bullet = formatStatusBullet(status, theme, isRtk);
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
	isRtk = false,
): string[] {
	const status: ToolStatus = isPartial ? "running" : result?.isError ? "error" : "success";
	const bullet = formatStatusBullet(status, theme, isRtk);
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

const OSC133_ZONE_START = "\x1b]133;A\x07";
const OSC133_ZONE_END = "\x1b]133;B\x07";
const OSC133_ZONE_FINAL = "\x1b]133;C\x07";

export function withPromptZoneMarkers(lines: string[]): string[] {
	if (lines.length === 0) return lines;
	if (lines.length === 1) {
		return [`${OSC133_ZONE_START}${lines[0]}${OSC133_ZONE_END}${OSC133_ZONE_FINAL}`];
	}
	const marked = [...lines];
	marked[0] = `${OSC133_ZONE_START}${marked[0]}`;
	marked[marked.length - 1] = `${OSC133_ZONE_END}${OSC133_ZONE_FINAL}${marked[marked.length - 1]}`;
	return marked;
}

export function makeMarkdownTheme(theme: Theme): MarkdownTheme {
	const fg = (color: Parameters<Theme["fg"]>[0], text: string) => theme.fg(color, text);
	return {
		heading: (text) => fg("mdHeading", text),
		link: (text) => fg("mdLink", text),
		linkUrl: (text) => fg("mdLinkUrl", text),
		code: (text) => fg("mdCode", text),
		codeBlock: (text) => fg("mdCodeBlock", text),
		codeBlockBorder: (text) => fg("mdCodeBlockBorder", text),
		quote: (text) => fg("mdQuote", text),
		quoteBorder: (text) => fg("mdQuoteBorder", text),
		hr: (text) => fg("mdHr", text),
		listBullet: (text) => fg("mdListBullet", text),
		bold: (text) => theme.bold(text),
		italic: (text) => theme.italic(text),
		underline: (text) => theme.underline(text),
		strikethrough: (text) => theme.strikethrough(text),
	};
}

export function formatUserMessage(
	text: string,
	width: number,
	theme: Theme,
	markdownTheme?: MarkdownTheme,
	defaultTextStyle?: { color?: (content: string) => string },
	options?: Record<string, unknown>,
): string[] {
	const safeWidth = Math.max(0, Math.floor(width));
	if (safeWidth <= 0) return [];
	if (safeWidth <= 2) return [truncateToWidth(text, safeWidth, "")];

	const rail = `${theme.fg("accent", "│")} `;
	const railWidth = visibleWidth(rail);
	const contentWidth = Math.max(1, safeWidth - railWidth);

	const md = new Markdown(
		text,
		0,
		0,
		markdownTheme ?? makeMarkdownTheme(theme),
		defaultTextStyle ?? {
			color: (content: string) => theme.fg("userMessageText", content),
		},
		{
			preserveOrderedListMarkers: true,
			preserveBackslashEscapes: true,
			...options,
		},
	);

	const rawLines = md.render(contentWidth);
	const body = rawLines.length > 0 ? rawLines : [""];

	const row = (line: string) => {
		const available = Math.max(0, safeWidth - railWidth);
		const truncated = truncateToWidth(line, available, "");
		const pad = " ".repeat(Math.max(0, available - visibleWidth(truncated)));
		return truncateToWidth(`${rail}${truncated}${pad}`, safeWidth, "");
	};

	const lines = [row(""), ...body.map(row), row("")];

	return withPromptZoneMarkers(lines);
}
