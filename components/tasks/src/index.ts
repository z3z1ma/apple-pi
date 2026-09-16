import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { inChildSessionContext } from "../../subagents/src/child-context.js";
import { createBackgroundTaskBashTool } from "./bash-tool.js";
import { formatTaskNotification } from "./notifications.js";
import { TaskManager } from "./task-manager.js";
import { createTaskManagementTool } from "./task-tool.js";
import { TASK_NOTIFICATION_CUSTOM_TYPE, type TaskNotificationDetails } from "./types.js";

export function installTasks(pi: ExtensionAPI): void {
	if (inChildSessionContext()) return;

	const taskManager = new TaskManager();

	taskManager.onTaskFinished((task) => {
		const content = formatTaskNotification(task);
		pi.sendMessage<TaskNotificationDetails>(
			{
				customType: TASK_NOTIFICATION_CUSTOM_TYPE,
				content,
				display: true,
				details: {
					taskId: task.id,
					status: task.status,
					exitCode: task.exitCode,
					command: task.command,
					durationMs: (task.endedAt ?? Date.now()) - task.startedAt,
					outputPreview: task.output.getSnapshot().content.slice(-500),
				},
			},
			{ deliverAs: "followUp", triggerTurn: true },
		);
	});

	pi.registerMessageRenderer<TaskNotificationDetails>(TASK_NOTIFICATION_CUSTOM_TYPE, (message, { expanded }, theme) => {
		const details = message.details;
		if (!details) return undefined;
		const isSuccess = details.status === "completed";
		const icon = isSuccess ? theme.fg("success", "✓") : theme.fg("error", "✗");
		const durationSec = Math.round((details.durationMs / 1000) * 10) / 10;
		const header = `${icon} ${theme.bold(`Background Task ${details.taskId}`)} ${theme.fg("dim", `(${details.status}, ${durationSec}s, exit ${details.exitCode ?? "?"})`)}`;
		const cmd = theme.fg("muted", `$ ${details.command}`);
		if (!details.outputPreview) {
			return new Text(`${header}\n  ${cmd}`, 0, 0);
		}
		const lines = details.outputPreview.split("\n");
		const preview = expanded ? details.outputPreview : lines.slice(-3).join("\n");
		return new Text(
			`${header}\n  ${cmd}\n${preview
				.split("\n")
				.map((l) => `  ${theme.fg("dim", l)}`)
				.join("\n")}`,
			0,
			0,
		);
	});

	pi.registerTool(createBackgroundTaskBashTool(taskManager));
	pi.registerTool(createTaskManagementTool(taskManager));

	const cleanup = () => {
		taskManager.killAll();
		taskManager.cleanupAll();
	};

	pi.on("session_shutdown", cleanup);
	pi.on("session_before_switch", cleanup);
	pi.on("session_before_fork", cleanup);
}

export default installTasks;
export { TaskManager } from "./task-manager.js";
export { OutputBuffer } from "./output-buffer.js";
export * from "./types.js";
