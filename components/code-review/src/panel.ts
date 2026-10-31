import { stripVTControlCharacters } from "node:util";
import {
	type Component,
	isKeyRelease,
	Key,
	matchesKey,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import { createViewerKeys, type ViewerKeybindings, type ViewerKeys } from "../../shared/src/viewer-keys.js";
import { approvalLabel, costLabel, targetLabel } from "./presentation.js";
import type { ReviewQueue, ReviewSummary } from "./results.js";

export interface ReviewTheme {
	fg(color: string, text: string): string;
	bg(color: string, text: string): string;
	bold(text: string): string;
}
export type ReviewPanelSource = (options: {
	limit: number;
	offset: number;
	around?: string;
	detailLimit: number;
	detailOffset: number;
}) => {
	queue: ReviewQueue;
	selected?: string;
	detail: { title: string; lines: string[]; nextOffset: number | null; offset: number };
};
export interface ReviewPanelActions {
	close(): void;
	unfocus(): void;
	menu(review: ReviewSummary | undefined): void;
	view(review: ReviewSummary | undefined): void;
}
const terminalText = (text: string) =>
	stripVTControlCharacters(text).replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, " ");
const oneLine = (text: string) => terminalText(text).replace(/\s+/g, " ").trim();
const pad = (text: string, width: number) => {
	const clipped = truncateToWidth(text, width, "\u2026");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
};

function stateStyle(state: ReviewSummary["state"]): { icon: string; color: string } {
	switch (state) {
		case "completed":
			return { icon: "\u2713", color: "accent" };
		case "failed":
			return { icon: "\u00d7", color: "error" };
		case "incomplete":
		case "interrupted":
		case "cancelling":
			return { icon: "!", color: "warning" };
		case "running":
		case "capturing":
			return { icon: "\u25cf", color: "accent" };
		case "queued":
			return { icon: "\u25cb", color: "muted" };
		default:
			return { icon: "\u2013", color: "muted" };
	}
}

function rule(theme: ReviewTheme, width: number, label = "", active = false): string {
	const text = label ? ` ${oneLine(label)} ` : "";
	const clipped = truncateToWidth(text, Math.max(0, width), "\u2026");
	return theme.fg(
		active ? "borderAccent" : "borderMuted",
		theme.bold(clipped) + "\u2500".repeat(Math.max(0, width - visibleWidth(clipped))),
	);
}

export class CaptureConfirmation implements Component {
	private scroll = 0;
	private bodyRows = 1;
	private canConfirm = false;
	private readonly keys: ViewerKeys;
	constructor(
		private readonly tui: { terminal: { rows: number }; requestRender(): void },
		private readonly theme: ReviewTheme,
		private readonly content: string[],
		private readonly done: (confirmed: boolean) => void,
		keybindings?: ViewerKeybindings,
	) {
		this.keys = createViewerKeys(keybindings);
	}
	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (matchesKey(data, Key.escape) || matchesKey(data, "q")) this.done(false);
		else if (matchesKey(data, "y") && this.canConfirm) this.done(true);
		else if (this.keys.scrollUp(data)) this.scroll = Math.max(0, this.scroll - 1);
		else if (this.keys.scrollDown(data)) this.scroll += 1;
		else if (this.keys.pageUp(data)) this.scroll = Math.max(0, this.scroll - this.bodyRows);
		else if (this.keys.pageDown(data)) this.scroll += this.bodyRows;
		else if (matchesKey(data, Key.home)) this.scroll = 0;
		else if (matchesKey(data, Key.end)) this.scroll = Number.MAX_SAFE_INTEGER;
		this.tui.requestRender();
	}
	render(width: number): string[] {
		const height = Math.max(1, Math.floor(this.tui.terminal.rows * 0.8));
		const footer = "y queue  Esc cancel";
		this.canConfirm = width >= visibleWidth(footer) + 4 && height >= 7;
		if (!this.canConfirm) return [truncateToWidth("Enlarge terminal; Esc cancels", Math.max(0, width), "")];
		this.bodyRows = height - 6;
		const lines = this.content.flatMap((line) => wrapTextWithAnsi(terminalText(line), width - 4));
		this.scroll = Math.min(this.scroll, Math.max(0, lines.length - this.bodyRows));
		const edge = (text: string) => this.theme.fg("borderAccent", text);
		const frame = (line: string) => edge("\u2502") + pad(` ${line}`, width - 2) + edge("\u2502");
		return [
			edge("\u256d") + rule(this.theme, width - 2, "Capture preview", true) + edge("\u256e"),
			frame(this.theme.fg("warning", "Queueing can incur model cost.")),
			edge("\u251c") + rule(this.theme, width - 2, "arrows / PgUp / PgDn scroll") + edge("\u2524"),
			...Array.from({ length: this.bodyRows }, (_, index) => frame(lines[this.scroll + index] ?? "")),
			edge("\u251c") + rule(this.theme, width - 2) + edge("\u2524"),
			frame(this.theme.bold(this.theme.fg("accent", footer))),
			edge("\u2570") + rule(this.theme, width - 2) + edge("\u256f"),
		];
	}
	invalidate(): void {}
}

export class ReviewPanel implements Component {
	focused = false;
	private data: ReviewQueue = { total: 0, states: {}, page: null };
	private error: string | undefined;
	private selected: string | undefined;
	private pageSize = 0;
	private bodyRows = 1;
	private masterRows = 1;
	private masterWidth = 1;
	private masterTop = 2;
	private detailTitle = "Summary";
	private detailRows = 1;
	private wide = false;
	private focusDetail = false;
	private offset = 0;
	private detailOffset = 0;
	private detailNext: number | null = null;
	private scroll = 0;
	private content: string[] = [];
	private contentLength = 0;
	private note = "";

	constructor(
		private readonly tui: { terminal: { rows: number }; requestRender(): void },
		private readonly theme: ReviewTheme,
		private readonly source: ReviewPanelSource,
		private readonly actions: ReviewPanelActions,
		selected?: string,
	) {
		this.selected = selected;
	}

	getSelectedId(): string | undefined {
		return this.selected;
	}
	current(): ReviewSummary | undefined {
		return this.data.page?.rows.find((row) => row.id === this.selected);
	}
	setNote(note: string): void {
		this.note = note;
		this.scroll = 0;
		this.tui.requestRender();
	}
	resetDetail(): void {
		this.detailOffset = 0;
		this.scroll = 0;
		this.refresh();
	}

	refresh(keepSelection = true): void {
		if (!this.pageSize) return;
		try {
			const view = this.source({
				limit: this.pageSize,
				offset: this.offset,
				detailLimit: this.detailRows,
				detailOffset: keepSelection ? this.detailOffset : 0,
				...(keepSelection && this.selected ? { around: this.selected } : {}),
			});
			this.data = view.queue;
			this.offset = this.data.page?.offset ?? 0;
			if (this.selected !== view.selected) this.scroll = 0;
			this.selected = view.selected;
			this.content = view.detail.lines;
			this.detailTitle = view.detail.title;
			this.detailNext = view.detail.nextOffset;
			this.detailOffset = view.detail.offset;
			this.error = undefined;
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		}
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (matchesKey(data, "q") || matchesKey(data, "ctrl+w")) {
			this.actions.close();
			return;
		}
		if (matchesKey(data, Key.escape) || matchesKey(data, "alt+g")) {
			this.actions.unfocus();
			return;
		}
		if (matchesKey(data, "a")) {
			this.actions.menu(this.current());
			return;
		}
		if (matchesKey(data, "v")) {
			this.actions.view(this.current());
			return;
		}
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.enter)) this.focusDetail = !this.focusDetail;
		else if (matchesKey(data, "]") || matchesKey(data, "[")) this.page(matchesKey(data, "]") ? 1 : -1);
		else if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.pageUp)) {
			const direction = matchesKey(data, Key.pageDown) ? 1 : -1;
			if (this.focusDetail) this.scroll = Math.max(0, this.scroll + direction * this.detailRows);
			else this.page(direction);
		} else if (matchesKey(data, Key.up) || matchesKey(data, Key.down)) {
			const direction = matchesKey(data, Key.down) ? 1 : -1;
			if (this.focusDetail) this.scroll = Math.max(0, this.scroll + direction);
			else this.move(direction);
		}
		this.tui.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		const inMaster = this.wide ? event.x <= this.masterWidth : event.y < this.masterTop + this.masterRows;
		if (event.type === "press" && event.button === "left") {
			this.focusDetail = !inMaster;
			if (inMaster && event.y >= this.masterTop && event.y < this.masterTop + this.masterRows)
				this.select(Math.floor((event.y - this.masterTop) / 4));
			this.tui.requestRender();
			return { focus: true };
		}
		return undefined;
	}

	render(width: number): string[] {
		const height = Math.max(1, Math.floor(this.tui.terminal.rows * 0.8));
		const fullKeys = "a actions  v evidence  Tab pane  arrows move  [ ] page  Esc editor  q close";
		const keys =
			width >= fullKeys.length + 4 ? [fullKeys] : ["a actions  v view  Tab pane", "arrows move  [ ] page  q close"];
		const chrome = 5 + keys.length;
		if (width < Math.max(...keys.map((line) => line.length)) + 4 || height < chrome + 5)
			return [truncateToWidth("Reviews: enlarge terminal; q closes", Math.max(0, width), "")];
		const previousDetailRows = this.detailRows;
		this.wide = width >= 100;
		this.bodyRows = height - chrome;
		this.masterRows = this.wide ? this.bodyRows : Math.max(4, Math.floor(this.bodyRows / 3 / 4) * 4);
		this.detailRows = this.wide ? this.bodyRows : this.bodyRows - this.masterRows;
		this.masterWidth = this.wide ? Math.floor((width - 3) * 0.4) : width - 2;
		this.masterTop = this.wide ? 3 : 2;
		const size = Math.max(1, Math.floor(this.masterRows / 4));
		if (size !== this.pageSize || this.detailRows !== previousDetailRows) {
			this.pageSize = size;
			this.refresh();
		}
		const edge = (text: string) => this.theme.fg(this.focused ? "border" : "borderMuted", text);
		const frame = (line: string) => edge("\u2502") + pad(line, width - 2) + edge("\u2502");
		const total = this.data.total;
		const rows = this.data.page?.rows.length ?? 0;
		const range = rows ? `${this.offset + 1}-${this.offset + rows} of ${total}` : `0 of ${total}`;
		const queueLabel = `${!this.focusDetail && this.focused ? "> " : ""}Queue  ${range}`;
		const title = `Review queue${this.error ? " - unavailable" : ` (${total})`}${this.focused ? "" : " - Alt+G to focus"}`;
		const top = edge("\u256d") + rule(this.theme, width - 2, title, this.focused) + edge("\u256e");
		const bottom = [
			edge("\u251c") + rule(this.theme, width - 2) + edge("\u2524"),
			...keys.map((line) => frame(this.theme.fg("muted", ` ${line}`))),
			edge("\u2570") + rule(this.theme, width - 2) + edge("\u256f"),
		];
		if (this.error)
			return [
				top,
				...this.lines(["Review store unavailable", "", this.error], width - 4, height - bottom.length - 1, false).map(
					(line) => frame(` ${line}`),
				),
				...bottom,
			];
		const master = this.master(this.masterWidth);
		const detailWidth = this.wide ? width - this.masterWidth - 3 : width - 2;
		const detail = this.lines(
			[...(this.note ? ["Operation", this.note, ""] : []), ...this.content],
			detailWidth - 2,
			this.detailRows,
			true,
		).map((line) => pad(` ${line}`, detailWidth));
		const queueRule = rule(this.theme, this.masterWidth, queueLabel, this.focused && !this.focusDetail);
		const position = this.contentLength
			? `lines ${this.scroll + 1}-${Math.min(this.scroll + this.detailRows, this.contentLength)}/${this.contentLength}`
			: "no evidence";
		const detailLabel = `${this.focusDetail && this.focused ? "> " : ""}${this.detailTitle}  ${this.selected?.slice(-8) ?? ""} | ${position}`;
		const detailRule = rule(this.theme, detailWidth, detailLabel, this.focused && this.focusDetail);
		if (!this.wide)
			return [
				top,
				edge("\u251c") + queueRule + edge("\u2524"),
				...master.map(frame),
				edge("\u251c") + detailRule + edge("\u2524"),
				...detail.map(frame),
				...bottom,
			];
		const states = Object.entries(this.data.states)
			.filter(([, count]) => count)
			.map(([state, count]) => `${count} ${state}`)
			.join("  \u00b7  ");
		return [
			top,
			frame(this.theme.fg("muted", ` ${states || "Captured assessments and their evidence"}`)),
			edge("\u251c") + queueRule + edge("\u252c") + detailRule + edge("\u2524"),
			...master.map((line, index) => edge("\u2502") + line + edge("\u2502") + detail[index] + edge("\u2502")),
			...bottom,
		];
	}

	invalidate(): void {}

	private lines(content: string[], width: number, height: number, scrolling: boolean): string[] {
		const wrapped = content.flatMap((line) => wrapTextWithAnsi(this.paintEvidence(terminalText(line)), width));
		if (scrolling) {
			this.contentLength = wrapped.length;
			this.scroll = Math.min(this.scroll, Math.max(0, wrapped.length - height));
		}
		const offset = scrolling ? this.scroll : 0;
		return Array.from({ length: height }, (_, index) => wrapped[offset + index] ?? "");
	}

	private paintEvidence(text: string): string {
		if (
			[
				"Assessment",
				"Review plan",
				"Captured target",
				"Operation",
				"Review store unavailable",
				"Trigger",
				"Impact",
				"Invariant",
				"Cause",
				"Proposed correction",
				"Evidence",
				"Counterevidence",
				"Validation evidence",
				"Owner response evidence",
			].includes(text)
		)
			return this.theme.fg(text === "Review store unavailable" ? "error" : "accent", this.theme.bold(text));
		if (/^\[(critical|high|medium|low)\]/.test(text)) return this.theme.fg("warning", this.theme.bold(text));
		const label = text.match(/^(\s*[\w][\w -]*:)(.*)$/);
		if (!label) return this.theme.fg("text", text);
		let color = "text";
		if (label[1] === "Execution:") color = stateStyle(this.current()?.state ?? "queued").color;
		if (label[1] === "Live target freshness:" || (label[1] === "Findings:" && this.current()?.findings.reported))
			color = "warning";
		return this.theme.fg("muted", label[1]!) + this.theme.fg(color, label[2]!);
	}

	private master(width: number): string[] {
		const lines: string[] = [];
		for (const review of this.data.page?.rows ?? []) {
			const selected = review.id === this.selected;
			const style = stateStyle(review.state);
			const row = (text: string, color: string, bold = false) => {
				const clipped = pad(` ${oneLine(text)}`, width);
				const painted = this.theme.fg(color, bold ? this.theme.bold(clipped) : clipped);
				return selected ? this.theme.bg("selectedBg", painted) : painted;
			};
			lines.push(
				row(
					`${selected ? ">" : " "} ${style.icon} ${review.state}${review.phase ? `: ${review.phase.pass}` : ""}`,
					style.color,
					true,
				),
				row(`  ${review.cwd.split(/[\\/]/).at(-1)}: ${targetLabel(review.target)} | ${review.ownerName}`, "text"),
				row(
					`  ${review.passes ? `${review.passes.completed}/${review.passes.required} passes` : review.state === "no-changes" ? "no reviewers" : "not planned"} | ${review.findings.confirmed} confirmed | ${costLabel(review.cost)}`,
					review.findings.confirmed ? "warning" : "muted",
				),
				row(
					`  ${review.findings.unresolved} unresolved | ${approvalLabel(review)}`,
					review.findings.unresolved ? "warning" : "muted",
				),
			);
		}
		if (!lines.length) lines.push(...wrapTextWithAnsi(" No recorded reviews. Press a to capture one.", width));
		return Array.from({ length: this.masterRows }, (_, index) => pad(lines[index] ?? "", width));
	}

	private select(index: number): void {
		const row = this.data.page?.rows[index];
		if (!row || row.id === this.selected) return;
		this.selected = row.id;
		this.detailOffset = 0;
		this.scroll = 0;
		this.note = "";
		this.refresh();
	}
	private move(direction: number): void {
		const rows = this.data.page?.rows ?? [];
		const index = rows.findIndex((row) => row.id === this.selected) + direction;
		if (index < 0 || index >= rows.length) this.page(direction);
		else this.select(index);
	}
	private page(direction: number): void {
		if (this.focusDetail) {
			if (direction > 0 && this.detailNext === null) return;
			this.detailOffset = direction > 0 ? this.detailNext! : Math.max(0, this.detailOffset - this.detailRows);
			this.scroll = 0;
			this.refresh();
			return;
		}
		if (direction > 0 && this.data.page?.nextOffset === null) return;
		this.offset = direction > 0 ? (this.data.page?.nextOffset ?? 0) : Math.max(0, this.offset - this.pageSize);
		this.refresh(false);
	}
}
