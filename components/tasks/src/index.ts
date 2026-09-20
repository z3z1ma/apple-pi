import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { getActiveWorkSurface } from "../../shared/src/active-work.js";
import { inChildSessionContext } from "../../subagents/src/child-context.js";
import { createTaskActiveWorkSource } from "./active-work.js";
import { createBackgroundTaskBashTool } from "./bash-tool.js";
import { createMonitorTool } from "./monitor-tool.js";
import { formatMonitorEvent, formatTaskNotification } from "./notifications.js";
import { createScheduleTool } from "./schedule-tool.js";
import { TaskManager } from "./task-manager.js";
import { createTaskManagementTool } from "./task-tool.js";
import {
	MONITOR_EVENT_CUSTOM_TYPE,
	type MonitorEventDetails,
	type PromptTask,
	SCHEDULED_PROMPT_CUSTOM_TYPE,
	TASK_NOTIFICATION_CUSTOM_TYPE,
	type TaskNotificationDetails,
} from "./types.js";
import { openTaskManager, TaskDetailViewer } from "./ui/task-manager.js";

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
	const activeWork = getActiveWorkSurface(pi);
	const unregisterActiveWork = activeWork.registerSource(createTaskActiveWorkSource(taskManager));
	const unsubscribeActiveWork = taskManager.onTaskChanged(() => activeWork.update());
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

	taskManager.onMonitorEvent((event) => {
		pi.sendMessage<MonitorEventDetails>(
			{
				customType: MONITOR_EVENT_CUSTOM_TYPE,
				content: formatMonitorEvent(event),
				display: true,
				details: {
					taskId: event.task.id,
					command: event.task.command,
					line: event.line,
					eventIndex: event.eventIndex,
					maxEvents: event.task.monitor?.maxEvents,
					reachedLimit: event.reachedLimit,
				},
			},
			{ deliverAs: "steer", triggerTurn: true },
		);
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
					monitor: task.monitor !== undefined,
					outputPreview: task.output.getSnapshot().content.slice(-500),
				},
			},
			{ deliverAs: "followUp", triggerTurn: true },
		);
	});

	pi.registerMessageRenderer<MonitorEventDetails>(MONITOR_EVENT_CUSTOM_TYPE, (message, _options, theme) => {
		const details = message.details;
		if (!details) return undefined;
		const position =
			details.maxEvents === undefined ? String(details.eventIndex) : `${details.eventIndex}/${details.maxEvents}`;
		const header = `${theme.fg("accent", "↯")} ${theme.bold(`Monitor ${details.taskId}`)} ${theme.fg("dim", `(event ${position})`)}`;
		const suffix = details.reachedLimit
			? `\n  ${theme.fg("warning", "Event limit reached; continuing silently.")}`
			: "";
		return new Text(`${header}\n  ${theme.fg("muted", details.line)}${suffix}`, 0, 0);
	});

	pi.registerMessageRenderer<TaskNotificationDetails>(TASK_NOTIFICATION_CUSTOM_TYPE, (message, { expanded }, theme) => {
		const details = message.details;
		if (!details) return undefined;
		const isSuccess = details.status === "completed";
		const icon = isSuccess ? theme.fg("success", "✓") : theme.fg("error", "✗");
		const durationSec = Math.round((details.durationMs / 1000) * 10) / 10;
		const label = details.monitor ? "Monitor" : "Background Task";
		const header = `${icon} ${theme.bold(`${label} ${details.taskId}`)} ${theme.fg("dim", `(${details.status}, ${durationSec}s, exit ${details.exitCode ?? "?"})`)}`;
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
	pi.registerTool(createMonitorTool(taskManager));
	pi.registerTool(createTaskManagementTool(taskManager));

	const openTaskDetail = async (ctx: ExtensionCommandContext, task: ReturnType<TaskManager["get"]>) => {
		if (!ctx.hasUI || !task) return;
		await ctx.ui.custom<undefined>(
			(tui, theme, keybindings, done) =>
				new TaskDetailViewer(
					tui,
					task,
					theme,
					() => done(undefined),
					() => {
						taskManager.cancel(task.id);
					},
					keybindings,
				),
			{ overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "80%" } },
		);
	};

	pi.registerCommand("tasks", {
		description: "Inspect and manage session-local scheduled prompts, commands, and monitors",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) return;
			await openTaskManager(ctx.ui, {
				getTasks: () => taskManager.list(),
				inspect: (task) => openTaskDetail(ctx, task),
			});
		},
	});

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
		taskManager.reset();
		activeWork.update();
	};
	pi.on("session_start", (_event, ctx) => {
		cleanup();
		if (ctx.hasUI) activeWork.setUICtx(ctx.ui);
	});
	pi.on("session_shutdown", () => {
		cleanup();
		unsubscribeActiveWork();
		unregisterActiveWork();
		activeWork.clearUI();
	});
	pi.on("session_before_switch", cleanup);
	pi.on("session_before_fork", cleanup);
	pi.on("session_before_tree", cleanup);
	pi.on("session_tree", cleanup);
}

export default installTasks;
export {
	createBackgroundTaskBashTool,
	createBashToolDefinition,
	createExecBashToolDefinition,
	prepareShellCommand,
} from "./bash-tool.js";
export { createMonitorTool } from "./monitor-tool.js";
export { OutputBuffer } from "./output-buffer.js";
export { createScheduleTool } from "./schedule-tool.js";
export { TaskManager } from "./task-manager.js";
export * from "./types.js";
