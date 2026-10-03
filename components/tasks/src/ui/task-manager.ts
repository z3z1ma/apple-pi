import {
	type Component,
	isKeyRelease,
	Key,
	matchesKey,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { ActiveWorkTheme } from "../../../shared/src/active-work.js";
import {
	createViewerKeys,
	formatViewerKey,
	type ViewerKeybindings,
	type ViewerKeys,
} from "../../../shared/src/viewer-keys.js";
import type { WorkSectionComponent } from "../../../shared/src/work-manager.js";
import { isActiveTask, type ManagedTask, taskPreview } from "../types.js";

/**
 * Most task rows shown above the selected task's detail; longer lists scroll
 * around the selection. Short terminals get fewer rows so the detail keeps its chrome.
 */
const MAX_LIST_ROWS = 5;

function taskLabel(task: ManagedTask): "Prompt" | "Command" | "Monitor" {
	if (task.kind === "prompt") return "Prompt";
	return task.monitor ? "Monitor" : "Command";
}

function elapsed(ms: number): string {
	return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

function taskState(task: ManagedTask): string {
	if (task.status === "scheduled") return `scheduled · due in ${elapsed(task.dueAt - Date.now())}`;
	if (task.status === "due") return "due";
	if (task.status === "running") {
		return `running · ${elapsed(Date.now() - (task.kind === "command" ? (task.startedAt ?? task.createdAt) : task.createdAt))}`;
	}
	return task.status;
}

function taskSummary(task: ManagedTask): string {
	if (task.kind === "prompt") return taskPreview(task);
	const parts = [taskPreview(task)];
	if (task.monitor) {
		const count =
			task.monitor.maxEvents === undefined
				? String(task.monitor.deliveredEvents)
				: `${task.monitor.deliveredEvents}/${task.monitor.maxEvents}`;
		parts.push(`events ${count}`, task.monitor.muted ? "delivery silent" : "delivery active");
	}
	return parts.join(" · ");
}

function orderedTasks(tasks: readonly ManagedTask[]): ManagedTask[] {
	return [...tasks].sort((left, right) => {
		const activeOrder = Number(isActiveTask(right)) - Number(isActiveTask(left));
		return activeOrder || right.createdAt - left.createdAt;
	});
}

/**
 * Tasks tab of the shared work panel: the session's task roster with the
 * selected task's detail below it. The work panel owns mounting, focus, tabs,
 * Esc, and q; this tab owns selection, scrolling, and confirmed cancellation.
 */
export class TaskPanel implements WorkSectionComponent {
	rowBudget: number;
	private hasFocus = false;
	private selectedId: string | undefined;
	private detail: TaskDetailViewer | undefined;
	private detailTask: ManagedTask | undefined;
	private readonly refreshTimer: ReturnType<typeof setInterval>;

	constructor(
		private readonly tui: TUI,
		private readonly theme: ActiveWorkTheme,
		private readonly getTasks: () => readonly ManagedTask[],
		selectedId: string | undefined,
		private readonly cancel: (id: string) => void,
		private readonly keybindings?: ViewerKeybindings,
		/** Where each task's detail was left, kept by the owner for the process lifetime. */
		private readonly views: Map<string, TaskDetailView> = new Map(),
	) {
		this.selectedId = selectedId;
		this.rowBudget = Math.floor(tui.terminal.rows * 0.7);
		this.refreshTimer = setInterval(() => this.tui.requestRender(), 500);
		this.refreshTimer.unref();
	}

	get focused(): boolean {
		return this.hasFocus;
	}

	set focused(value: boolean) {
		this.hasFocus = value;
		if (this.detail) this.detail.focused = value;
	}

	getSelectedId(): string | undefined {
		return this.selectedId;
	}

	title(): string {
		return `Tasks · ${this.getTasks().length}`;
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab"))) {
			const tasks = orderedTasks(this.getTasks());
			if (tasks.length === 0) return;
			const index = Math.max(
				0,
				tasks.findIndex((task) => task.id === this.selectedId),
			);
			const step = matchesKey(data, Key.tab) ? 1 : -1;
			this.selectedId = tasks[(index + step + tasks.length) % tasks.length]?.id;
			this.syncDetail();
			this.tui.requestRender();
			return;
		}
		this.syncDetail()?.handleInput(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel") return undefined;
		this.detail?.scrollBy(event.wheelDelta ?? 0);
		return { handled: true };
	}

	render(width: number): string[] {
		if (width < 6) return [];
		const innerWidth = width - 4;
		const row = (content: string) => {
			const clipped = truncateToWidth(content, innerWidth, "");
			return `${this.theme.fg("border", "│")} ${clipped}${" ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)))} ${this.theme.fg("border", "│")}`;
		};
		const tasks = orderedTasks(this.getTasks());
		const detail = this.syncDetail();
		if (!detail) {
			return [row(this.theme.fg("muted", "(no tasks)")), this.theme.fg("border", `╰${"─".repeat(width - 2)}╯`)];
		}
		const selectedIndex = Math.max(
			0,
			tasks.findIndex((task) => task.id === this.selectedId),
		);
		const listRows = Math.max(0, Math.min(MAX_LIST_ROWS, this.rowBudget - detail.minimumRows()));
		const start = Math.max(0, Math.min(selectedIndex - Math.floor(listRows / 2), tasks.length - listRows));
		const lines = tasks.slice(start, start + listRows).map((task) => {
			const marker = task.id === this.selectedId ? this.theme.fg("accent", "›") : " ";
			const icon = isActiveTask(task) ? this.theme.fg("accent", "●") : this.theme.fg("dim", "○");
			return row(`${marker} ${icon} ${taskLabel(task)} ${task.id} · ${taskState(task)} · ${taskSummary(task)}`);
		});
		detail.rowBudget = this.rowBudget;
		detail.reservedRows = lines.length;
		return [...lines, ...detail.render(width)];
	}

	invalidate(): void {}

	dispose(): void {
		clearInterval(this.refreshTimer);
		this.releaseDetail(this.getTasks().includes(this.detailTask as ManagedTask));
	}

	/** Keep one detail view bound to the selected task, falling back to the first. */
	private syncDetail(): TaskDetailViewer | undefined {
		const tasks = orderedTasks(this.getTasks());
		const task = tasks.find((candidate) => candidate.id === this.selectedId) ?? tasks[0];
		this.selectedId = task?.id;
		if (task && task === this.detailTask && this.detail) return this.detail;
		// Task IDs restart with each session's roster, so only a task still in the
		// roster keeps its position; a reset roster must not seed a new task with the same ID.
		this.releaseDetail(tasks.includes(this.detailTask as ManagedTask));
		if (!task) return undefined;
		this.detailTask = task;
		this.detail = new TaskDetailViewer(
			this.tui,
			task,
			this.theme,
			// The work panel handles Esc and q before keys reach this view.
			() => {},
			() => this.cancel(task.id),
			this.keybindings,
			this.views.get(task.id),
		);
		this.detail.joinTop = true;
		this.detail.focused = this.hasFocus;
		return this.detail;
	}

	private releaseDetail(keepView: boolean): void {
		if (keepView && this.detail && this.detailTask) this.views.set(this.detailTask.id, this.detail.view);
		this.detail?.dispose();
		this.detail = undefined;
		this.detailTask = undefined;
	}
}

/** Where a task detail viewer was left: a scroll offset, or following the live tail. */
export interface TaskDetailView {
	scrollOffset: number;
	autoScroll: boolean;
}

/** Rows of detail chrome: top border, title, two separators, footer, bottom border. */
const DETAIL_CHROME_ROWS = 6;

export class TaskDetailViewer implements Component {
	/** Draw a `├─┤` joint instead of a rounded top border so the view continues a panel box. */
	joinTop = false;
	/** Rows the embedding panel allows; omitted → 70% of the terminal height. */
	rowBudget: number | undefined;
	/** Rows the embedding panel draws above this view within its budget. */
	reservedRows = 0;
	private scrollOffset: number;
	private hasFocus = false;
	private autoScroll: boolean;
	private lastContentLines = 0;
	private lastViewportHeight = 1;
	private cancelArmed = false;
	private closed = false;
	private readonly keys: ViewerKeys;
	private readonly refreshTimer: ReturnType<typeof setInterval>;

	constructor(
		private readonly tui: TUI,
		private readonly task: ManagedTask,
		private readonly theme: ActiveWorkTheme,
		private readonly done: () => void,
		private readonly onCancel?: () => void,
		keybindings?: ViewerKeybindings,
		initialView: TaskDetailView = { scrollOffset: 0, autoScroll: true },
	) {
		this.scrollOffset = initialView.scrollOffset;
		this.autoScroll = initialView.autoScroll;
		this.keys = createViewerKeys(keybindings);
		this.refreshTimer = setInterval(() => {
			if (!this.closed) this.tui.requestRender();
		}, 250);
		this.refreshTimer.unref();
	}

	/** Keyboard focus, set by the embedding panel; losing it drops a pending cancel confirmation. */
	get focused(): boolean {
		return this.hasFocus;
	}

	set focused(value: boolean) {
		this.hasFocus = value;
		if (!value) this.cancelArmed = false;
	}

	/** Fewest rows that show the full chrome and one content row. */
	minimumRows(): number {
		return DETAIL_CHROME_ROWS + 1;
	}

	/** Scroll by lines; negative moves up. Reaching the end resumes following the live tail. */
	scrollBy(lines: number): void {
		const maxScroll = Math.max(0, this.lastContentLines - this.lastViewportHeight);
		this.scrollOffset = Math.min(maxScroll, Math.max(0, this.scrollOffset + lines));
		this.autoScroll = this.scrollOffset >= maxScroll;
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.closed = true;
			this.done();
			return;
		}
		if (matchesKey(data, "x")) {
			if (this.canCancel()) {
				if (this.cancelArmed) {
					this.cancelArmed = false;
					this.onCancel?.();
				} else this.cancelArmed = true;
				this.tui.requestRender();
			}
			return;
		}
		if (this.cancelArmed) this.cancelArmed = false;
		const maxScroll = Math.max(0, this.lastContentLines - this.lastViewportHeight);
		if (this.keys.scrollUp(data)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - 1);
			this.autoScroll = false;
		} else if (this.keys.scrollDown(data)) {
			this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1);
			this.autoScroll = this.scrollOffset >= maxScroll;
		} else if (this.keys.pageUp(data)) {
			this.scrollOffset = Math.max(0, this.scrollOffset - this.lastViewportHeight);
			this.autoScroll = false;
		} else if (this.keys.pageDown(data)) {
			this.scrollOffset = Math.min(maxScroll, this.scrollOffset + this.lastViewportHeight);
			this.autoScroll = this.scrollOffset >= maxScroll;
		} else if (matchesKey(data, "home")) {
			this.scrollOffset = 0;
			this.autoScroll = false;
		} else if (matchesKey(data, "end")) {
			this.scrollOffset = maxScroll;
			this.autoScroll = true;
		} else return;
		this.tui.requestRender();
	}

	render(width: number): string[] {
		if (width < 6) return [];
		const innerWidth = width - 4;
		const row = (content: string) => {
			const clipped = truncateToWidth(content, innerWidth, "");
			return `${this.theme.fg("border", "│")} ${clipped}${" ".repeat(Math.max(0, innerWidth - visibleWidth(clipped)))} ${this.theme.fg("border", "│")}`;
		};
		const top = this.theme.fg("border", this.joinTop ? `├${"─".repeat(width - 2)}┤` : `╭${"─".repeat(width - 2)}╮`);
		const bottom = this.theme.fg("border", `╰${"─".repeat(width - 2)}╯`);
		const separator = row(this.theme.fg("dim", "─".repeat(innerWidth)));
		const content = this.contentLines(innerWidth);
		const maxRows = Math.max(1, (this.rowBudget ?? Math.floor(this.tui.terminal.rows * 0.7)) - this.reservedRows);
		const footerActions = this.canCancel()
			? this.cancelArmed
				? this.theme.fg("error", "x again to CANCEL")
				: this.theme.fg("dim", "x cancel")
			: "";
		const footer = [
			footerActions,
			this.theme.fg(
				"dim",
				`${formatViewerKey(this.keys.upKey)}/${formatViewerKey(this.keys.downKey)} scroll · ${formatViewerKey(this.keys.pageUpKey)}/${formatViewerKey(this.keys.pageDownKey)} page · Esc editor · q close`,
			),
		]
			.filter(Boolean)
			.join(" · ");
		this.lastContentLines = content.length;
		const compact = maxRows <= DETAIL_CHROME_ROWS;
		const viewportHeight = Math.max(0, maxRows - (compact ? 2 : DETAIL_CHROME_ROWS));
		this.lastViewportHeight = Math.max(1, viewportHeight);
		const maxScroll = Math.max(0, content.length - viewportHeight);
		if (this.autoScroll) this.scrollOffset = maxScroll;
		const start = Math.min(this.scrollOffset, maxScroll);
		const visible = content.slice(start, start + viewportHeight);
		if (compact) {
			const title = row(this.theme.bold(`${taskLabel(this.task)} ${this.task.id}`));
			return maxRows === 1 ? [title] : [title, ...visible.map(row), row(footer)];
		}
		return [
			top,
			row(this.theme.bold(`${taskLabel(this.task)} ${this.task.id}`)),
			separator,
			...Array.from({ length: viewportHeight }, (_, index) => row(visible[index] ?? "")),
			separator,
			row(footer),
			bottom,
		];
	}

	get view(): TaskDetailView {
		return { scrollOffset: this.scrollOffset, autoScroll: this.autoScroll };
	}

	invalidate(): void {}

	dispose(): void {
		this.closed = true;
		clearInterval(this.refreshTimer);
	}

	private canCancel(): boolean {
		return !!this.onCancel && isActiveTask(this.task);
	}

	private contentLines(width: number): string[] {
		const lines: string[] = [];
		const add = (text: string) => lines.push(...wrapTextWithAnsi(text, width));
		add(this.theme.fg("text", `Status: ${this.task.status}`));
		add(this.theme.fg("muted", `Created: ${new Date(this.task.createdAt).toISOString()}`));
		add(this.theme.fg("muted", `Due: ${new Date(this.task.dueAt).toISOString()}`));
		if (this.task.endedAt !== undefined) {
			add(this.theme.fg("muted", `Ended: ${new Date(this.task.endedAt).toISOString()}`));
		}
		lines.push("");
		if (this.task.kind === "prompt") {
			lines.push(this.theme.bold("Prompt"));
			lines.push(...wrapTextWithAnsi(this.task.prompt, width));
			return lines;
		}

		add(this.theme.fg("text", `Command: ${this.task.command}`));
		add(this.theme.fg("muted", `Working directory: ${this.task.cwd}`));
		if (this.task.startedAt !== undefined) {
			add(this.theme.fg("muted", `Started: ${new Date(this.task.startedAt).toISOString()}`));
		}
		if (this.task.pid !== undefined) add(this.theme.fg("muted", `PID: ${this.task.pid}`));
		if (this.task.exitCode !== undefined) {
			add(this.theme.fg("muted", `Exit code: ${this.task.exitCode ?? "signal"}`));
		}
		if (this.task.monitor) {
			const limit = this.task.monitor.maxEvents;
			lines.push(
				this.theme.fg(
					"muted",
					`Events delivered: ${limit === undefined ? this.task.monitor.deliveredEvents : `${this.task.monitor.deliveredEvents}/${limit}`}`,
				),
			);
			const delivery = isActiveTask(this.task)
				? this.task.monitor.muted
					? "silent until completion"
					: "active"
				: "finished";
			lines.push(this.theme.fg("muted", `Delivery: ${delivery}`));
		}
		lines.push("", this.theme.bold("Output"));
		const snapshot = this.task.output.getSnapshot();
		const output = snapshot.content || "(no output yet)";
		for (const outputLine of output.split("\n")) lines.push(...wrapTextWithAnsi(outputLine, width));
		if (snapshot.truncated) {
			add(this.theme.fg("warning", "Output is truncated."));
			if (snapshot.fullOutputPath) add(this.theme.fg("muted", `Full output: ${snapshot.fullOutputPath}`));
		}
		return lines;
	}
}
