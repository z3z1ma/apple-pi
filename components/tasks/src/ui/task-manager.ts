import {
	type Component,
	isKeyRelease,
	matchesKey,
	type TUI,
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
import { isActiveTask, type ManagedTask, taskPreview } from "../types.js";

export type TaskManagerAction = { type: "close" } | { type: "inspect"; id: string };

export interface TaskManagerUI {
	custom<T>(
		factory: (tui: TUI, theme: ActiveWorkTheme, keybindings: ViewerKeybindings, done: (result: T) => void) => Component,
		options?: { overlay?: boolean; overlayOptions?: Record<string, unknown> },
	): Promise<T>;
}

export interface OpenTaskManagerOptions {
	getTasks(): readonly ManagedTask[];
	inspect(task: ManagedTask): Promise<void>;
}

export async function openTaskManager(ui: TaskManagerUI, options: OpenTaskManagerOptions): Promise<void> {
	let selectedId: string | undefined;
	while (true) {
		const action = await ui.custom<TaskManagerAction>(
			(tui, theme, keybindings, done) =>
				new TaskManagerComponent(tui, theme, options.getTasks, selectedId, done, keybindings),
			{ overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "80%" } },
		);
		if (action.type === "close") return;
		selectedId = action.id;
		const task = options.getTasks().find((candidate) => candidate.id === action.id);
		if (task) await options.inspect(task);
	}
}

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

export class TaskManagerComponent implements Component {
	private selectedId: string | undefined;
	private readonly keys: ViewerKeys;
	private readonly refreshTimer: ReturnType<typeof setInterval>;

	constructor(
		private readonly tui: TUI,
		private readonly theme: ActiveWorkTheme,
		private readonly getTasks: () => readonly ManagedTask[],
		selectedId: string | undefined,
		private readonly done: (action: TaskManagerAction) => void,
		keybindings?: ViewerKeybindings,
	) {
		this.selectedId = selectedId;
		this.keys = createViewerKeys(keybindings);
		this.refreshTimer = setInterval(() => this.tui.requestRender(), 500);
		this.refreshTimer.unref();
	}

	handleInput(data: string): void {
		if (isKeyRelease(data)) return;
		if (matchesKey(data, "escape") || matchesKey(data, "q")) {
			this.done({ type: "close" });
			return;
		}
		const tasks = orderedTasks(this.getTasks());
		if (tasks.length === 0) return;
		let index = Math.max(
			0,
			tasks.findIndex((task) => task.id === this.selectedId),
		);
		if (this.keys.scrollUp(data)) index = Math.max(0, index - 1);
		else if (this.keys.scrollDown(data)) index = Math.min(tasks.length - 1, index + 1);
		else if (matchesKey(data, "enter")) {
			this.done({ type: "inspect", id: tasks[index].id });
			return;
		} else return;
		this.selectedId = tasks[index].id;
		this.tui.requestRender();
	}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		const line = (text: string) => truncateToWidth(text, renderWidth, "");
		const tasks = orderedTasks(this.getTasks());
		if (!this.selectedId || !tasks.some((task) => task.id === this.selectedId)) this.selectedId = tasks[0]?.id;
		const selectedIndex = Math.max(
			0,
			tasks.findIndex((task) => task.id === this.selectedId),
		);
		const maxLines = Math.max(1, Math.floor(this.tui.terminal.rows * 0.8));
		const lines = [line(this.theme.fg("accent", this.theme.bold(`Tasks · ${tasks.length}`)))];
		if (maxLines === 1) return lines;
		const slots = Math.max(0, maxLines - 2);
		const start = Math.max(0, Math.min(selectedIndex - Math.floor(slots / 2), tasks.length - slots));
		for (const task of tasks.slice(start, start + slots)) {
			const icon = isActiveTask(task) ? this.theme.fg("accent", "●") : this.theme.fg("dim", "○");
			lines.push(
				line(
					`${task.id === this.selectedId ? ">" : " "} ${icon} ${taskLabel(task)} ${task.id} · ${taskState(task)} · ${taskSummary(task)}`,
				),
			);
		}
		lines.push(
			line(
				this.theme.fg(
					"dim",
					`${formatViewerKey(this.keys.upKey)}/${formatViewerKey(this.keys.downKey)} select · Enter inspect · Esc close`,
				),
			),
		);
		return lines;
	}

	invalidate(): void {}

	dispose(): void {
		clearInterval(this.refreshTimer);
	}
}

export class TaskDetailViewer implements Component {
	private scrollOffset = 0;
	private autoScroll = true;
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
	) {
		this.keys = createViewerKeys(keybindings);
		this.refreshTimer = setInterval(() => {
			if (!this.closed) this.tui.requestRender();
		}, 250);
		this.refreshTimer.unref();
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
		const top = this.theme.fg("border", `╭${"─".repeat(width - 2)}╮`);
		const bottom = this.theme.fg("border", `╰${"─".repeat(width - 2)}╯`);
		const separator = row(this.theme.fg("dim", "─".repeat(innerWidth)));
		const content = this.contentLines(innerWidth);
		const maxRows = Math.max(1, Math.floor(this.tui.terminal.rows * 0.7));
		const footerActions = this.canCancel()
			? this.cancelArmed
				? this.theme.fg("error", "x again to CANCEL")
				: this.theme.fg("dim", "x cancel")
			: "";
		const footer = [
			footerActions,
			this.theme.fg(
				"dim",
				`${formatViewerKey(this.keys.upKey)}/${formatViewerKey(this.keys.downKey)} scroll · ${formatViewerKey(this.keys.pageUpKey)}/${formatViewerKey(this.keys.pageDownKey)} page · Esc close`,
			),
		]
			.filter(Boolean)
			.join(" · ");
		this.lastContentLines = content.length;
		if (maxRows < 6) {
			this.lastViewportHeight = Math.max(1, maxRows - 2);
			if (maxRows === 1) return [row(this.theme.bold(`${taskLabel(this.task)} ${this.task.id}`))];
			const bodySlots = Math.max(0, maxRows - 2);
			const body = bodySlots > 0 ? content.slice(-bodySlots).map(row) : [];
			return [row(this.theme.bold(`${taskLabel(this.task)} ${this.task.id}`)), ...body, row(footer)];
		}
		const viewportHeight = maxRows - 6;
		this.lastViewportHeight = Math.max(1, viewportHeight);
		const maxScroll = Math.max(0, content.length - viewportHeight);
		this.scrollOffset = this.autoScroll ? maxScroll : Math.min(this.scrollOffset, maxScroll);
		const visible = content.slice(this.scrollOffset, this.scrollOffset + viewportHeight);
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
