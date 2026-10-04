import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type Component,
	isKeyRelease,
	type KeybindingsManager,
	matchesKey,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { createViewerKeys, type ViewerKeys } from "../../shared/src/viewer-keys.js";
import { formatStatusBullet, formatToolName, parseDiff } from "./formatters.js";
import type { ToolStatus } from "./types.js";

export const TOOL_VIEWER_HEIGHT_PCT = 80;

export interface ToolInspectionContentBlock {
	type: string;
	text?: string;
	data?: string;
	mimeType?: string;
}

export interface ToolInspection {
	toolName: string;
	toolCallId: string;
	args: unknown;
	result?: {
		content?: ToolInspectionContentBlock[];
		details?: unknown;
		isError?: boolean;
	};
	isPartial: boolean;
}

type ToolViewerTab = "inputs" | "output";

function formatInputsLines(args: unknown, theme: Theme): string[] {
	if (!args || (typeof args === "object" && Object.keys(args).length === 0)) {
		return [theme.fg("muted", "(no arguments)")];
	}
	if (typeof args !== "object") {
		return typeof args === "string" ? args.split("\n") : [String(args)];
	}
	const lines: string[] = [];
	const entries = Object.entries(args as Record<string, unknown>);
	for (let i = 0; i < entries.length; i++) {
		const [key, val] = entries[i];
		const header = theme.bold(theme.fg("accent", `${key}:`));
		if (typeof val === "string" && val.includes("\n")) {
			lines.push(header, ...val.split("\n").map((l) => `  ${l}`));
		} else if (typeof val === "object" && val !== null) {
			lines.push(
				header,
				...JSON.stringify(val, null, 2)
					.split("\n")
					.map((l) => `  ${l}`),
			);
		} else {
			const textVal =
				val === undefined ? theme.fg("dim", "undefined") : val === null ? theme.fg("dim", "null") : String(val);
			lines.push(`${header} ${textVal}`);
		}
		if (i < entries.length - 1) lines.push("");
	}
	return lines;
}

function formatDiffSection(details: unknown, theme: Theme): string[] {
	const diffText = typeof details === "string" ? details : (details as any)?.diff || (details as any)?.patch;
	if (typeof diffText !== "string" || !diffText.trim()) return [];
	const { added, removed, lines } = parseDiff(diffText);
	if (lines.length === 0) return [];
	const diffLines = [
		theme.bold(`Diff: ${theme.fg("toolDiffAdded", `+${added}`)} / ${theme.fg("toolDiffRemoved", `-${removed}`)} lines`),
		"",
	];
	for (const dl of lines) {
		const color = dl.type === "added" ? "toolDiffAdded" : dl.type === "removed" ? "toolDiffRemoved" : "dim";
		diffLines.push(theme.fg(color, dl.content));
	}
	return diffLines;
}

function formatOutputLines(result: ToolInspection["result"], isPartial: boolean, theme: Theme): string[] {
	if (!result) {
		return [
			isPartial
				? `${theme.fg("warning", "● ")}${theme.fg("muted", "(tool execution in progress... waiting for output)")}`
				: theme.fg("muted", "(no output recorded)"),
		];
	}
	const lines: string[] = [];
	if (result.isError) {
		lines.push(theme.bold(theme.fg("error", "● Execution failed with error:")), "");
	}
	if (result.content) {
		for (const block of result.content) {
			if (block.type === "text" && block.text) {
				lines.push(...block.text.split("\n"));
			} else if (block.type === "image") {
				const size = block.data ? `, ~${Math.round((block.data.length * 3) / 4096)} KB` : "";
				lines.push(theme.fg("accent", `[Image: ${block.mimeType || "image"}${size}]`));
			} else if (block.text) {
				lines.push(...block.text.split("\n"));
			}
		}
	}
	const diffLines = formatDiffSection(result.details, theme);
	if (diffLines.length > 0) {
		if (lines.length > 0) lines.push("");
		lines.push(...diffLines);
	}
	const details = result.details as any;
	if (details && typeof details === "object") {
		const extra = Object.fromEntries(Object.entries(details).filter(([k]) => k !== "diff" && k !== "patch"));
		if (Object.keys(extra).length > 0) {
			if (lines.length > 0) lines.push("");
			lines.push(
				theme.bold(theme.fg("accent", "Details:")),
				...JSON.stringify(extra, null, 2)
					.split("\n")
					.map((l) => `  ${l}`),
			);
		}
	}
	if (lines.length === 0) {
		lines.push(
			theme.fg(
				result.isError ? "error" : "muted",
				result.isError ? "(tool failed with no output)" : "(tool completed with no output)",
			),
		);
	}
	return lines;
}

export class ToolViewer implements Component {
	private _activeTab: ToolViewerTab = "inputs";
	private inputsScrollTop = 0;
	private outputScrollTop = 0;
	private closed = false;
	private readonly keys: ViewerKeys;
	private refreshTimer?: ReturnType<typeof setInterval>;
	private lastWidth = 0;
	private lastViewportHeight = 1;
	private lastContentLength = 0;
	private readonly tabRanges: Array<{ tab: ToolViewerTab; start: number; end: number }> = [];

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		keybindings: KeybindingsManager,
		private readonly done: () => void,
		private readonly getInspection: () => ToolInspection,
	) {
		this.keys = createViewerKeys(keybindings);
		if (this.getInspection().isPartial) this.startPolling();
	}

	private startPolling(): void {
		if (this.refreshTimer || this.closed) return;
		this.refreshTimer = setInterval(() => {
			if (this.closed) {
				this.stopPolling();
				return;
			}
			this.tui.requestRender();
			if (!this.getInspection().isPartial) this.stopPolling();
		}, 200);
		this.refreshTimer.unref?.();
	}

	private stopPolling(): void {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = undefined;
		}
	}

	dispose(): void {
		this.closed = true;
		this.stopPolling();
	}

	invalidate(): void {
		this.tui.requestRender();
	}

	close(): void {
		if (this.closed) return;
		this.dispose();
		this.done();
	}

	switchTab(tab?: ToolViewerTab): void {
		this._activeTab = tab ?? (this._activeTab === "inputs" ? "output" : "inputs");
		if (this.lastWidth > 0) this.render(this.lastWidth);
		this.tui.requestRender();
	}

	private get currentScroll(): number {
		return this._activeTab === "inputs" ? this.inputsScrollTop : this.outputScrollTop;
	}

	private set currentScroll(val: number) {
		if (this._activeTab === "inputs") this.inputsScrollTop = val;
		else this.outputScrollTop = val;
	}

	private getMaxScroll(): number {
		return Math.max(0, this.lastContentLength - this.lastViewportHeight);
	}

	scrollBy(delta: number): void {
		const maxScroll = this.getMaxScroll();
		this.currentScroll = Math.max(0, Math.min(maxScroll, this.currentScroll + delta));
		this.tui.requestRender();
	}

	scrollTo(offset: number): void {
		const maxScroll = this.getMaxScroll();
		this.currentScroll = Math.max(0, Math.min(maxScroll, offset));
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (this.closed || isKeyRelease(data)) return;

		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.close();
			return;
		}

		if (matchesKey(data, "tab") || matchesKey(data, "shift+tab")) {
			this.switchTab();
			return;
		}

		if (data === "1") {
			this.switchTab("inputs");
			return;
		}
		if (data === "2") {
			this.switchTab("output");
			return;
		}

		const maxScroll = this.getMaxScroll();
		if (this.keys.scrollUp(data)) {
			this.scrollBy(-1);
		} else if (this.keys.scrollDown(data)) {
			this.scrollBy(1);
		} else if (this.keys.pageUp(data)) {
			this.scrollBy(-this.lastViewportHeight);
		} else if (this.keys.pageDown(data)) {
			this.scrollBy(this.lastViewportHeight);
		} else if (matchesKey(data, "home")) {
			this.scrollTo(0);
		} else if (matchesKey(data, "end")) {
			this.scrollTo(maxScroll);
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (this.closed) return undefined;
		if (event.type === "wheel") {
			this.scrollBy(event.wheelDelta ?? 0);
			return { handled: true };
		}
		if (event.type === "press" && event.button === "left" && event.y === 1) {
			const match = this.tabRanges.find((r) => event.x >= r.start && event.x < r.end);
			if (match) {
				this.switchTab(match.tab);
				return { handled: true };
			}
		}
		return undefined;
	}

	render(width: number): string[] {
		this.lastWidth = width;
		const termRows = this.tui.terminal.rows;
		const budget = Math.floor((termRows * TOOL_VIEWER_HEIGHT_PCT) / 100);
		if (width < 6 || budget < 4) return [];

		const inspection = this.getInspection();
		if (inspection.isPartial && !this.refreshTimer) this.startPolling();

		const th = this.theme;
		const innerW = Math.max(1, width - 4);

		const status: ToolStatus = inspection.isPartial ? "running" : inspection.result?.isError ? "error" : "success";
		const bullet = formatStatusBullet(status, th);
		const name = formatToolName(inspection.toolName, th);
		const id = inspection.toolCallId ? th.fg("dim", `(${inspection.toolCallId})`) : "";
		const tag = inspection.isPartial ? th.fg("warning", " [running]") : "";

		let title = `${bullet} ${name} ${id}${tag}`.trim();
		if (visibleWidth(title) + 5 > width) title = `${bullet} ${name}${tag}`.trim();
		if (visibleWidth(title) + 5 > width) title = `${bullet} ${name}`.trim();
		if (visibleWidth(title) + 5 > width) title = truncateToWidth(title, Math.max(1, width - 5), "...");

		const rem = Math.max(0, width - visibleWidth(title) - 5);
		const topBorder = `${th.fg("border", "╭─ ")}${title} ${th.fg("border", `${"─".repeat(rem)}╮`)}`;

		this.tabRanges.length = 0;
		const inLabel =
			this._activeTab === "inputs" ? th.bold(th.fg("accent", "[ Inputs ]")) : th.fg("muted", "  Inputs  ");
		const outLabel =
			this._activeTab === "output" ? th.bold(th.fg("accent", "[ Output ]")) : th.fg("muted", "  Output  ");
		this.tabRanges.push({ tab: "inputs", start: 2, end: 2 + visibleWidth(inLabel) });
		this.tabRanges.push({
			tab: "output",
			start: 2 + visibleWidth(inLabel) + 1,
			end: 2 + visibleWidth(inLabel) + 1 + visibleWidth(outLabel),
		});

		const tabs = `${inLabel} ${outLabel}`;
		const hint = innerW - visibleWidth(tabs) >= 28 ? th.fg("dim", "Tab: tab · ↑/↓: scroll · Esc: close") : "";
		const tabContent = hint
			? `${tabs}${" ".repeat(Math.max(1, innerW - visibleWidth(tabs) - visibleWidth(hint)))}${hint}`
			: tabs;
		const clippedTab = truncateToWidth(tabContent, innerW, "");
		const tabRow = `${th.fg("border", "│")} ${clippedTab}${" ".repeat(Math.max(0, innerW - visibleWidth(clippedTab)))} ${th.fg("border", "│")}`;

		const showSep = budget > 4;
		const separator = th.fg("border", `├${"─".repeat(width - 2)}┤`);

		const raw =
			this._activeTab === "inputs"
				? formatInputsLines(inspection.args, th)
				: formatOutputLines(inspection.result, inspection.isPartial, th);

		const wrapped: string[] = [];
		for (const r of raw) {
			if (visibleWidth(r) <= innerW) wrapped.push(r);
			else wrapped.push(...wrapTextWithAnsi(r, innerW));
		}
		if (wrapped.length === 0) wrapped.push("");

		const chromeCount = showSep ? 4 : 3;
		const maxViewport = Math.max(1, budget - chromeCount);
		const viewportHeight = Math.min(maxViewport, wrapped.length);
		this.lastViewportHeight = viewportHeight;
		this.lastContentLength = wrapped.length;

		const maxScroll = Math.max(0, wrapped.length - viewportHeight);
		const scrollTop = Math.max(0, Math.min(maxScroll, this.currentScroll));
		this.currentScroll = scrollTop;

		const visible = wrapped.slice(scrollTop, scrollTop + viewportHeight);
		const rows = visible.map((line) => {
			const clipped = truncateToWidth(line, innerW, "");
			return `${th.fg("border", "│")} ${clipped}${" ".repeat(Math.max(0, innerW - visibleWidth(clipped)))} ${th.fg("border", "│")}`;
		});

		const info =
			wrapped.length > viewportHeight
				? ` (${scrollTop + 1}-${Math.min(wrapped.length, scrollTop + viewportHeight)} of ${wrapped.length}) `
				: "";
		let bot = th.fg("border", `╰${"─".repeat(Math.max(0, width - 2))}╯`);
		if (info && width - 4 >= visibleWidth(info)) {
			const total = width - 2 - visibleWidth(info);
			const left = Math.max(0, total - 2);
			bot = `${th.fg("border", `╰${"─".repeat(left)}`)}${th.fg("dim", info)}${th.fg("border", `${"─".repeat(total - left)}╯`)}`;
		}

		return showSep ? [topBorder, tabRow, separator, ...rows, bot] : [topBorder, tabRow, ...rows, bot];
	}
}
