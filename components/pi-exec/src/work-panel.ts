import {
	isKeyRelease,
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";
import { createViewerKeys, type ViewerKeys } from "../../shared/src/viewer-keys.js";
import type { WorkSectionComponent, WorkSectionUI } from "../../shared/src/work-manager.js";
import type { ExecutionOperation, ExecutionOutcome } from "./types.js";
import { callLabel, formatDuration, safeText, type ExecActivitySnapshot } from "./ui.js";

const VIEWS = ["calls", "source", "result", "trace"] as const;
type View = (typeof VIEWS)[number];
type ContentPosition = { line: number; column: number };

export interface ExecInvocation {
	id: string;
	code: string;
	status: "running" | ExecutionOutcome;
	activity: ExecActivitySnapshot;
	output?: string;
	error?: string;
	trace?: ExecutionOperation[];
	view?: { mode: View; call: number; offset: number; follow: boolean; anchor?: ContentPosition };
}

export class ExecPanel implements WorkSectionComponent {
	focused = false;
	rowBudget = 0;
	private selectedId: string | undefined;
	private readonly keys: ViewerKeys;
	private readonly timer: ReturnType<typeof setInterval>;
	private contentRows = 0;
	private viewportRows = 1;
	private offset = 0;
	private positions: ContentPosition[] = [];

	constructor(
		private readonly ui: WorkSectionUI,
		private readonly list: () => readonly ExecInvocation[],
		selectedId?: string,
	) {
		this.selectedId = selectedId;
		this.keys = createViewerKeys(ui.keybindings);
		this.timer = setInterval(() => ui.tui.requestRender(), 500);
		this.timer.unref();
	}

	title(): string {
		return `Pi Exec · ${this.list().length}`;
	}
	hints(): string[] {
		return ["v view", "[/] call"];
	}
	getSelectedId(): string | undefined {
		return this.current()?.id;
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		const current = this.current();
		if (!current) return;
		const view = current.view!;
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab"))) {
			const records = this.list();
			const index = records.indexOf(current);
			const step = matchesKey(data, Key.tab) ? 1 : -1;
			this.selectedId = records[(index + step + records.length) % records.length]?.id;
		} else if (matchesKey(data, "v")) {
			view.mode = VIEWS[(VIEWS.indexOf(view.mode) + 1) % VIEWS.length]!;
			view.offset = this.offset = 0;
			delete view.anchor;
			view.follow = false;
		} else if (matchesKey(data, "[") || matchesKey(data, "]")) {
			const count = current.activity.calls.length;
			if (count > 0) view.call = (view.call + (matchesKey(data, "]") ? 1 : -1) + count) % count;
			view.mode = "calls";
			view.offset = this.offset = 0;
			delete view.anchor;
			view.follow = false;
		} else if (this.keys.scrollUp(data)) this.scrollBy(-1);
		else if (this.keys.scrollDown(data)) this.scrollBy(1);
		else if (this.keys.pageUp(data)) this.scrollBy(-this.viewportRows);
		else if (this.keys.pageDown(data)) this.scrollBy(this.viewportRows);
		else if (matchesKey(data, Key.home)) {
			view.offset = this.offset = 0;
			delete view.anchor;
			view.follow = false;
		} else if (matchesKey(data, Key.end)) {
			view.offset = this.offset = Math.max(0, this.contentRows - this.viewportRows);
			view.follow = true;
		}
		this.ui.tui.requestRender();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel") return undefined;
		this.scrollBy(event.wheelDelta ?? 0);
		return { handled: true };
	}

	render(width: number): string[] {
		if (width < 6) return [];
		const { theme } = this.ui;
		const inner = width - 4;
		const row = (text: string) => {
			const clipped = truncateToWidth(text, inner, "");
			return `${theme.fg("border", "│")} ${clipped}${" ".repeat(Math.max(0, inner - visibleWidth(clipped)))} ${theme.fg("border", "│")}`;
		};
		const bottom = theme.fg("border", `╰${"─".repeat(width - 2)}╯`);
		const current = this.current();
		if (!current) return [row(theme.fg("muted", "(no programs)")), bottom];
		const { activity, view } = current;
		const header = [
			row(theme.bold(safeText(activity.name))),
			row(
				`${current.status} · ${formatDuration((activity.finishedAt ?? Date.now()) - activity.startedAt)} · ${view!.mode}`,
			),
		];
		const content = this.content(current, inner);
		this.contentRows = content.length;
		this.viewportRows = Math.max(1, this.rowBudget - header.length - 2);
		const maxOffset = Math.max(0, content.length - this.viewportRows);
		const anchor = view!.anchor;
		const projected = anchor
			? this.positions.findLastIndex(
					(position) =>
						position.line < anchor.line || (position.line === anchor.line && position.column <= anchor.column),
				)
			: view!.offset;
		this.offset = view!.follow ? maxOffset : Math.max(0, Math.min(projected, maxOffset));
		const offset = this.offset;
		const visible = content.slice(offset, offset + this.viewportRows).map(row);
		const footer = row(
			theme.fg(
				"dim",
				`${offset + 1}–${Math.min(content.length, offset + this.viewportRows)}/${content.length} · Tab program · v view · [/] call`,
			),
		);
		return [...header, ...visible, footer, bottom].slice(0, this.rowBudget);
	}

	invalidate(): void {}
	dispose(): void {
		clearInterval(this.timer);
	}

	private current(): ExecInvocation | undefined {
		const records = this.list();
		const current = records.find((record) => record.id === this.selectedId) ?? records[0];
		this.selectedId = current?.id;
		if (current) current.view ??= { mode: "calls", call: 0, offset: 0, follow: false };
		return current;
	}

	private scrollBy(delta: number): void {
		const view = this.current()?.view;
		if (!view) return;
		const max = Math.max(0, this.contentRows - this.viewportRows);
		view.offset = this.offset = Math.max(0, Math.min(max, (view.follow ? max : this.offset) + delta));
		view.anchor = this.positions[view.offset];
		view.follow = delta > 0 && view.offset === max;
		this.ui.tui.requestRender();
	}

	private content(record: ExecInvocation, width: number): string[] {
		const lines: string[] = [];
		this.positions = [];
		let logicalLine = 0;
		const add = (text: string) => {
			for (const line of text.split("\n")) {
				let column = 0;
				for (const wrapped of wrapTextWithAnsi(safeText(line), width)) {
					lines.push(wrapped);
					this.positions.push({ line: logicalLine, column });
					column += visibleWidth(wrapped);
				}
				logicalLine++;
			}
		};
		const { activity, view } = record;
		if (view!.mode === "source") {
			for (const [index, line] of record.code.split("\n").entries()) add(`${index + 1} ${line}`);
		} else if (view!.mode === "result") {
			const pendingMessage = record.status === "running" ? "Program is still running; no final result yet." : "";
			add([record.error, record.output ?? pendingMessage].filter(Boolean).join("\n\n"));
		} else if (view!.mode === "trace") {
			add(JSON.stringify(record.trace ?? activity.calls, null, 2));
		} else {
			if (activity.description) add(activity.description);
			const calls = activity.calls;
			const count = (status: string) => calls.filter((call) => call.status === status).length;
			const completed = calls.filter((call) => call.status !== "queued" && call.status !== "running").length;
			add(
				`${count("running")} running · ${count("queued")} queued · ${completed} completed · ${count("failed") + count("timed_out")} failed`,
			);
			view!.call = Math.min(view!.call, Math.max(0, calls.length - 1));
			const selected = calls[view!.call];
			if (selected) {
				add(`Selected call ${selected.sequence + 1}: ${callLabel(selected)}`);
				const now = selected.finishedAt ?? activity.finishedAt ?? Date.now();
				add(`Status: ${selected.status}`);
				if (selected.queuedAt !== undefined)
					add(`Queued: ${formatDuration((selected.startedAt ?? now) - selected.queuedAt)}`);
				if (selected.startedAt !== undefined) add(`Execution: ${formatDuration(now - selected.startedAt)}`);
				add(`Arguments: ${JSON.stringify(selected.args, null, 2)}`);
				if (selected.error) add(`Error: ${selected.error}`);
				if (selected.result !== undefined) add(`Result: ${JSON.stringify(selected.result, null, 2)}`);
			}
			add("Calls:");
			for (const [index, call] of calls.entries())
				add(`${index === view!.call ? "›" : " "} ${call.sequence + 1} ${call.status} · ${callLabel(call)}`);
			if (calls.length === 0) add("No host calls issued.");
		}
		return lines;
	}
}
