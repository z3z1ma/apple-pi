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
import { approvalLabel, targetLabel } from "./presentation.js";
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
}) => { queue: ReviewQueue; selected?: string; detail: { lines: string[]; nextOffset: number | null; offset: number } };
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
	const clipped = truncateToWidth(text, width, "");
	return clipped + " ".repeat(Math.max(0, width - visibleWidth(clipped)));
};

export class ReviewPanel implements Component {
	focused = false;
	private data: ReviewQueue = { total: 0, states: {}, page: null };
	private error: string | undefined;
	private selected: string | undefined;
	private pageSize = 0;
	private bodyRows = 1;
	private masterRows = 1;
	private masterWidth = 1;
	private detailRows = 1;
	private wide = false;
	private focusDetail = false;
	private offset = 0;
	private detailOffset = 0;
	private detailNext: number | null = null;
	private scroll = 0;
	private content: string[] = [];
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
		const inMaster = this.wide ? event.x < this.masterWidth : event.y < this.masterRows + 1;
		if (event.type === "press" && event.button === "left") {
			this.focusDetail = !inMaster;
			if (inMaster && event.y > 0) this.select(Math.floor((event.y - 1) / 3));
			this.tui.requestRender();
			return { focus: true };
		}
		return undefined;
	}

	render(width: number): string[] {
		const height = Math.max(1, Math.floor(this.tui.terminal.rows * 0.8));
		if (width < 8 || height < 5)
			return [truncateToWidth("Reviews: enlarge terminal; q closes", Math.max(0, width), "")];
		const previousDetailRows = this.detailRows;
		this.wide = width >= 100;
		this.bodyRows = height - 2;
		this.masterRows = this.wide ? this.bodyRows : Math.max(1, Math.floor((this.bodyRows - 1) / 2));
		this.detailRows = this.wide ? this.bodyRows : Math.max(1, this.bodyRows - this.masterRows - 1);
		this.masterWidth = this.wide ? Math.floor((width - 3) / 2) : width;
		const size = Math.max(1, Math.floor(this.masterRows / 3));
		if (size !== this.pageSize || this.detailRows !== previousDetailRows) {
			this.pageSize = size;
			this.refresh();
		}
		const header = this.theme.bold(
			`Review queue${this.error ? " - unavailable" : ` (${this.data.total})`} | ${this.focusDetail ? "Evidence" : "Queue"}${this.focused ? "" : " - Alt+G to focus"}`,
		);
		const footer = "q close  Esc editor  Tab focus  arrows move  [ ] page  v evidence  a actions";
		if (this.error)
			return [
				truncateToWidth(header, width, ""),
				...this.lines([this.error], width, this.bodyRows, false),
				truncateToWidth(footer, width, ""),
			];
		const master = this.master(this.masterWidth);
		const detailWidth = this.wide ? width - this.masterWidth - 3 : width;
		const detail = this.lines(
			[...(this.note ? [this.note, ""] : []), ...this.content],
			detailWidth,
			this.detailRows,
			true,
		);
		const body = this.wide
			? master.map((line, index) => `${pad(line, this.masterWidth)} | ${pad(detail[index] ?? "", detailWidth)}`)
			: [...master, this.theme.fg("border", "-".repeat(width)), ...detail];
		return [truncateToWidth(header, width, ""), ...body, truncateToWidth(footer, width, "")];
	}

	invalidate(): void {}

	private lines(content: string[], width: number, height: number, scrolling: boolean): string[] {
		const wrapped = content.flatMap((line) => wrapTextWithAnsi(terminalText(line), width));
		if (scrolling) this.scroll = Math.min(this.scroll, Math.max(0, wrapped.length - height));
		const offset = scrolling ? this.scroll : 0;
		return Array.from({ length: height }, (_, index) => truncateToWidth(wrapped[offset + index] ?? "", width, ""));
	}

	private master(width: number): string[] {
		const lines: string[] = [];
		for (const review of this.data.page?.rows ?? []) {
			const selected = review.id === this.selected;
			const rows = [
				`${selected ? ">" : " "} [${review.id.slice(-8)}] ${review.state}${review.phase ? `: ${review.phase.pass}` : ""} | ${review.ownerName}`,
				`  ${review.passes ? `${review.passes.completed}/${review.passes.required}` : "?"} passes | ${review.findings.confirmed} confirmed / ${review.findings.unresolved} unresolved`,
				`  ${approvalLabel(review)} | ${review.cwd.split(/[\\/]/).at(-1)}: ${targetLabel(review.target)}`,
			];
			for (const row of rows) {
				const text = pad(oneLine(row), width);
				lines.push(selected ? this.theme.bg("selectedBg", text) : text);
			}
		}
		if (!lines.length) lines.push("No recorded reviews. Use Actions to capture one.");
		return Array.from({ length: this.masterRows }, (_, index) => truncateToWidth(lines[index] ?? "", width, ""));
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
