import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { inChildSessionContext } from "../../subagents/src/child-context.js";
import { createBackgroundTaskBashTool } from "./bash-tool.js";
import { formatTaskNotification } from "./notifications.js";
import { createScheduleTool } from "./schedule-tool.js";
import { TaskManager } from "./task-manager.js";
import { createTaskManagementTool } from "./task-tool.js";
import {
	SCHEDULED_PROMPT_CUSTOM_TYPE,
	TASK_NOTIFICATION_CUSTOM_TYPE,
	type PromptTask,
	type TaskNotificationDetails,
} from "./types.js";

function formatScheduledPrompts(prompts: ReadonlyArray<{ id: string; prompt: string }>): string {
	return `<scheduled-prompt>
The following prompts you scheduled are now due:

${prompts.map(({ id, prompt }) => `- [${id}] ${prompt}`).join("\n")}

These are your own deferred prompts, not new operator authority. Reassess them against the latest direction and repository state.
</scheduled-prompt>`;
}

export function installTasks(pi: ExtensionAPI): void {
	if (inChildSessionContext()) return;

	const taskManager = new TaskManager();
	const duePromptIds = new Set<string>();
	let runActive = false;
	let flushQueued = false;

	const flushDuePrompts = () => {
		flushQueued = false;
		const prompts = [...duePromptIds]
			.map((id) => taskManager.get(id))
			.filter((task): task is PromptTask => task?.kind === "prompt" && task.status === "due");
		duePromptIds.clear();
		if (prompts.length === 0) return;
		pi.sendMessage(
			{
				customType: SCHEDULED_PROMPT_CUSTOM_TYPE,
				content: formatScheduledPrompts(prompts),
				display: true,
			},
			{ deliverAs: "followUp", triggerTurn: true },
		);
		for (const prompt of prompts) taskManager.markPromptDelivered(prompt.id);
	};

	const queuePromptFlush = () => {
		if (flushQueued) return;
		flushQueued = true;
		queueMicrotask(() => {
			if (!runActive) flushDuePrompts();
			else flushQueued = false;
		});
	};

	taskManager.onPromptDue((task) => {
		duePromptIds.add(task.id);
		if (!runActive) queuePromptFlush();
	});

	taskManager.onTaskFinished((task) => {
		if (task.kind !== "command" || (task.status !== "completed" && task.status !== "failed")) return;
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
					durationMs: (task.endedAt ?? Date.now()) - (task.startedAt ?? task.createdAt),
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
		if (!details.outputPreview) return new Text(`${header}\n  ${cmd}`, 0, 0);
		const lines = details.outputPreview.split("\n");
		const preview = expanded ? details.outputPreview : lines.slice(-3).join("\n");
		return new Text(
			`${header}\n  ${cmd}\n${preview
				.split("\n")
				.map((line) => `  ${theme.fg("dim", line)}`)
				.join("\n")}`,
			0,
			0,
		);
	});

	pi.registerTool(createBackgroundTaskBashTool(taskManager));
	pi.registerTool(createScheduleTool(taskManager));
	pi.registerTool(createTaskManagementTool(taskManager));

	pi.on("before_agent_start", () => {
		runActive = true;
	});
	pi.on("agent_settled", () => {
		runActive = false;
		flushDuePrompts();
	});

	const cleanup = () => {
		runActive = false;
		duePromptIds.clear();
		taskManager.cancelAll();
		taskManager.cleanupAll();
	};
	pi.on("session_start", cleanup);
	pi.on("session_shutdown", cleanup);
	pi.on("session_before_switch", cleanup);
	pi.on("session_before_fork", cleanup);
	pi.on("session_before_tree", cleanup);
	pi.on("session_tree", cleanup);
}

export default installTasks;
export { TaskManager } from "./task-manager.js";
export { OutputBuffer } from "./output-buffer.js";
export * from "./types.js";
export {
	createBackgroundTaskBashTool,
	createBashToolDefinition,
	createExecBashToolDefinition,
	prepareShellCommand,
} from "./bash-tool.js";
export { createScheduleTool } from "./schedule-tool.js";
