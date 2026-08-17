import type { Theme, ToolRenderResultOptions } from "@earendil-works/pi-coding-agent";
import { type Component, truncateToWidth } from "@earendil-works/pi-tui";

export type ExecCallStatus = "queued" | "running" | "succeeded" | "failed" | "aborted" | "timed_out";

export interface ExecActivityCall {
	sequence: number;
	ref: string;
	args: Record<string, unknown>;
	status: ExecCallStatus;
	activity?: string;
	result?: unknown;
	error?: string;
}

export interface ExecActivitySnapshot {
	name: string;
	description?: string;
	startedAt: number;
	finishedAt?: number;
	calls: ExecActivityCall[];
}

interface ExecRenderDetails {
	activity?: ExecActivitySnapshot;
}

interface ExecRenderContext {
	expanded: boolean;
	isError: boolean;
}

interface ExecRenderArgs {
	code: string;
	display?: { name?: string; description?: string };
}

const safeText = (value: string): string => value.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, " ");

const oneLine = (value: unknown, max = 80): string => {
	if (typeof value !== "string") return "";
	const clean = safeText(value).replace(/\s+/g, " ").trim();
	return clean.length <= max ? clean : `${clean.slice(0, Math.max(1, max - 1))}…`;
};

const formatDuration = (milliseconds: number): string => {
	const ms = Math.max(0, Math.round(milliseconds));
	if (ms < 1_000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1_000).toFixed(1)}s`;
	const seconds = Math.round(ms / 1_000);
	const minutes = Math.floor(seconds / 60);
	return `${minutes}m ${seconds % 60}s`;
};

const spinner = (now = Date.now()): string => ["◐", "◓", "◑", "◒"][Math.floor(now / 140) % 4]!;

const terminal = (status: ExecCallStatus): boolean => status !== "queued" && status !== "running";

const statusGlyph = (theme: Theme, status: ExecCallStatus): string => {
	if (status === "succeeded") return theme.fg("success", "✓");
	if (status === "failed" || status === "timed_out") return theme.fg("error", "✗");
	if (status === "aborted") return theme.fg("warning", "■");
	if (status === "queued") return theme.fg("dim", "○");
	return theme.fg("accent", spinner());
};

const callTarget = (call: ExecActivityCall): string => {
	const args = call.args;
	for (const key of ["path", "pattern", "command", "name", "task"]) {
		const value = oneLine(args[key], key === "task" ? 64 : 80);
		if (value) return value;
	}
	return "";
};

const resultSummary = (value: unknown): string => {
	if (typeof value === "string") return oneLine(value, 64);
	if (!value || typeof value !== "object" || Array.isArray(value)) return "";
	const result = value as Record<string, unknown>;
	const text =
		[result.output, result.text, result.status].map((candidate) => oneLine(candidate, 64)).find(Boolean) ?? "";
	const usage =
		result.usage && typeof result.usage === "object" ? (result.usage as Record<string, unknown>) : undefined;
	const tokens = typeof usage?.totalTokens === "number" ? `${usage.totalTokens.toLocaleString()} tok` : "";
	return [text, tokens].filter(Boolean).join(" · ");
};

const callLabel = (call: ExecActivityCall): string => {
	const ref = call.ref === "agents.run" ? "agent" : call.ref.replace(/^pi\./, "");
	const target = callTarget(call);
	const detail = call.activity || resultSummary(call.result);
	return `${ref}${target ? ` ${target}` : ""}${detail ? ` · ${oneLine(detail, 72)}` : ""}`;
};

class LineList implements Component {
	constructor(private readonly lines: string[]) {}

	invalidate(): void {}

	render(width: number): string[] {
		if (width <= 0) return [];
		return this.lines.map((line) => truncateToWidth(line, width, ""));
	}
}

const visibleCalls = (calls: ExecActivityCall[], expanded: boolean): ExecActivityCall[] => {
	const limit = expanded ? 30 : 8;
	if (calls.length <= limit) return calls;
	const active = calls.filter((call) => !terminal(call.status));
	const selected = new Set(active.slice(-limit).map((call) => call.sequence));
	for (let index = calls.length - 1; index >= 0 && selected.size < limit; index--) {
		selected.add(calls[index]!.sequence);
	}
	return calls.filter((call) => selected.has(call.sequence));
};

export const renderExecCall = (args: ExecRenderArgs, theme: Theme, context: ExecRenderContext): Component => {
	const codeLines = args.code.split("\n");
	const name = oneLine(args.display?.name, 80);
	const title = [
		theme.fg("toolTitle", theme.bold("pi_exec")),
		name ? theme.fg("accent", name) : "",
		theme.fg("dim", `JavaScript · ${codeLines.length} ${codeLines.length === 1 ? "line" : "lines"}`),
	]
		.filter(Boolean)
		.join(" ");
	const lines = [title];
	if (args.display?.description) lines.push(theme.fg("muted", oneLine(args.display.description, 140)));
	const limit = context.expanded ? Math.min(200, codeLines.length) : Math.min(8, codeLines.length);
	const digits = String(Math.max(1, limit)).length;
	for (let index = 0; index < limit; index++) {
		lines.push(
			`${theme.fg("dim", String(index + 1).padStart(digits, " "))} ${theme.fg("muted", safeText(codeLines[index] || " "))}`,
		);
	}
	const hidden = codeLines.length - limit;
	if (hidden > 0) {
		lines.push(
			theme.fg(
				"dim",
				`… ${hidden} lines hidden${context.expanded ? " (200-line display cap)" : " · ctrl-o to expand"}`,
			),
		);
	}
	return new LineList(lines);
};

export const renderExecResult = (
	result: { content?: Array<{ type: string; text?: string }>; details?: ExecRenderDetails },
	options: ToolRenderResultOptions,
	theme: Theme,
	context: ExecRenderContext,
): Component => {
	const activity = result.details?.activity;
	if (!activity) {
		const fallback =
			result.content
				?.filter((part) => part.type === "text")
				.map((part) => part.text ?? "")
				.join("\n") || "";
		return new LineList([theme.fg(context.isError ? "error" : "muted", oneLine(fallback, 200))]);
	}
	const calls = activity.calls;
	const done = calls.filter((call) => terminal(call.status)).length;
	const failed = calls.filter((call) => call.status === "failed" || call.status === "timed_out").length;
	const running = calls.filter((call) => call.status === "running").length;
	const now = activity.finishedAt ?? Date.now();
	const elapsed = formatDuration(now - activity.startedAt);
	const partial = options.isPartial;
	const headerGlyph = partial
		? theme.fg("warning", "◆")
		: context.isError || failed > 0
			? theme.fg("error", "✗")
			: theme.fg("success", "✓");
	const summary = partial
		? `${done}/${calls.length} calls${running > 0 ? ` · ${running} running` : ""} · ${elapsed}`
		: `${calls.length} calls${failed > 0 ? ` · ${failed} failed` : ""} · ${elapsed}`;
	const lines = [
		`${headerGlyph} ${theme.fg("accent", "Pi Exec")} ${theme.fg("muted", activity.name)} ${theme.fg("dim", `· ${summary}`)}`,
	];
	if (activity.description) lines.push(theme.fg("dim", oneLine(activity.description, 140)));
	for (const call of visibleCalls(calls, options.expanded)) {
		let row = `${statusGlyph(theme, call.status)} ${theme.fg("muted", callLabel(call))}`;
		if (call.error) row += ` ${theme.fg("error", `› ${oneLine(call.error, 100)}`)}`;
		lines.push(row);
	}
	const hidden = calls.length - visibleCalls(calls, options.expanded).length;
	if (hidden > 0) lines.push(theme.fg("dim", `… ${hidden} calls hidden · ctrl-o to expand`));

	if (!partial && options.expanded) {
		const output =
			result.content
				?.filter((part) => part.type === "text")
				.flatMap((part) => (part.text ?? "").split("\n"))
				.slice(0, 20) ?? [];
		if (output.length > 0) {
			lines.push(theme.fg("dim", "Result:"));
			lines.push(...output.map((line) => theme.fg("toolOutput", safeText(line))));
		}
	}
	return new LineList(lines);
};

export class ExecActivityWidget implements Component {
	private readonly interval: NodeJS.Timeout;

	constructor(
		private readonly theme: Theme,
		private readonly activity: () => ExecActivitySnapshot,
		private readonly requestRender: () => void,
		private readonly maxRows = 7,
	) {
		this.interval = setInterval(() => {
			try {
				requestRender();
			} catch {
				this.dispose();
			}
		}, 140);
		this.interval.unref?.();
	}

	refresh(): void {
		try {
			this.requestRender();
		} catch {
			this.dispose();
		}
	}

	invalidate(): void {}

	dispose(): void {
		clearInterval(this.interval);
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const activity = this.activity();
		const calls = activity.calls;
		const done = calls.filter((call) => terminal(call.status)).length;
		const active = calls.filter((call) => call.status === "running");
		const queued = calls.filter((call) => call.status === "queued");
		const elapsed = formatDuration(Date.now() - activity.startedAt);
		const parts = [
			calls.length > 0 ? `${done}/${calls.length} calls` : "starting",
			active.length > 0 ? `${active.length} running` : undefined,
			queued.length > 0 ? `${queued.length} queued` : undefined,
			elapsed,
		].filter((value): value is string => Boolean(value));
		const lines = [
			`${this.theme.fg("accent", spinner())} ${this.theme.fg("accent", "Pi Exec")} ${this.theme.fg("muted", activity.name)} ${this.theme.fg("dim", `· ${parts.join(" · ")}`)}`,
		];
		const shown = [...active, ...queued, ...calls.filter((call) => terminal(call.status)).slice(-2)]
			.filter((call, index, all) => all.findIndex((candidate) => candidate.sequence === call.sequence) === index)
			.slice(0, Math.max(0, this.maxRows - 1));
		for (const call of shown) {
			lines.push(`  ${statusGlyph(this.theme, call.status)} ${this.theme.fg("muted", callLabel(call))}`);
		}
		const hidden = Math.max(0, calls.length - shown.length);
		if (hidden > 0 && lines.length < this.maxRows) lines.push(this.theme.fg("dim", `  … ${hidden} more calls`));
		return lines.slice(0, this.maxRows).map((line) => truncateToWidth(line, width, ""));
	}
}
