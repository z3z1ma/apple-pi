import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ActiveWorkEntry, ActiveWorkSource, ActiveWorkTheme } from "../../shared/src/active-work.js";
import type { TaskManager } from "./task-manager.js";
import { isActiveTask, type CommandTask, type ManagedTask, taskPreview } from "./types.js";

function formatMs(ms: number): string {
	return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

function label(task: ManagedTask): "Prompt" | "Command" | "Monitor" {
	if (task.kind === "prompt") return "Prompt";
	return task.monitor ? "Monitor" : "Command";
}

function state(task: ManagedTask): string {
	if (task.status === "scheduled") return `due in ${formatMs(task.dueAt - Date.now())}`;
	if (task.status === "due") return "due now";
	return `running ${formatMs(Date.now() - (task.kind === "command" ? (task.startedAt ?? task.createdAt) : task.createdAt))}`;
}

function commandDetails(task: CommandTask): string {
	const parts = [taskPreview(task)];
	if (task.pid !== undefined) parts.push(`pid ${task.pid}`);
	if (task.monitor) {
		const limit =
			task.monitor.maxEvents === undefined
				? String(task.monitor.deliveredEvents)
				: `${task.monitor.deliveredEvents}/${task.monitor.maxEvents}`;
		parts.push(`events ${limit}`);
		parts.push(task.monitor.muted ? "delivery silent" : "delivery active");
	}
	return parts.join(" · ");
}

function renderTask(task: ManagedTask, width: number, theme: ActiveWorkTheme, frame: string): string[] {
	const taskLabel = label(task);
	const icon = task.status === "running" ? frame : task.status === "due" ? "!" : "◷";
	const summary = task.kind === "prompt" ? taskPreview(task) : commandDetails(task);
	return [
		truncateToWidth(
			`${theme.fg("dim", "├─")} ${theme.fg(task.status === "due" ? "warning" : "accent", icon)} ${theme.bold(taskLabel)} ${theme.fg("muted", task.id)} ${theme.fg("dim", `· ${state(task)}`)}`,
			width,
		),
		truncateToWidth(`${theme.fg("dim", "│  ")}  ${theme.fg("dim", `⎿  ${summary}`)}`, width),
	];
}

function entry(task: ManagedTask): ActiveWorkEntry {
	return {
		id: task.id,
		render: (width, theme, frame) => renderTask(task, width, theme, frame),
	};
}

export function createTaskActiveWorkSource(manager: TaskManager): ActiveWorkSource {
	return {
		key: "tasks",
		statusKey: "tasks",
		countLabel: "tasks",
		getEntries: () => manager.list().filter(isActiveTask).map(entry),
	};
}
