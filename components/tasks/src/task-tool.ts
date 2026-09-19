import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, defineTool, formatSize } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { TaskManager } from "./task-manager.js";
import { type ManagedTask, type TaskParameters, type TaskToolDetails, taskParameters } from "./types.js";

function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

function isActive(task: ManagedTask): boolean {
	return task.status === "scheduled" || task.status === "due" || task.status === "running";
}

function taskSummary(task: ManagedTask): string {
	return task.kind === "prompt" ? task.prompt : task.command;
}

function taskKind(task: ManagedTask): string {
	return task.kind === "command" && task.monitor ? "monitor" : task.kind;
}

function listTasks(taskManager: TaskManager) {
	const tasks = taskManager.list();
	if (tasks.length === 0) {
		return {
			content: [{ type: "text" as const, text: "No managed tasks found." }],
			details: {},
		};
	}

	const lines = [
		"Managed tasks:",
		"",
		"ID       KIND     STATUS      DUE                       PID     SUMMARY",
		"--------------------------------------------------------------------------------",
	];
	for (const task of tasks) {
		const id = task.id.padEnd(8);
		const kind = taskKind(task).padEnd(8);
		const status = task.status.padEnd(11);
		const due = new Date(task.dueAt).toISOString().padEnd(25);
		const pid = (task.kind === "command" && task.pid ? String(task.pid) : "-").padEnd(7);
		const rawSummary = taskSummary(task);
		const summary = rawSummary.length > 50 ? `${rawSummary.slice(0, 47)}...` : rawSummary;
		lines.push(`${id} ${kind} ${status} ${due} ${pid} ${summary}`);
	}
	return { content: [{ type: "text" as const, text: lines.join("\n") }], details: {} };
}

async function taskStatus(taskManager: TaskManager, taskId: string | undefined, waitSeconds: number | undefined) {
	if (!taskId) throw new Error("task_id is required for action: 'status'");
	let task = taskManager.get(taskId);
	if (!task) throw new Error(`Task '${taskId}' not found`);
	if (waitSeconds && waitSeconds > 0 && isActive(task)) {
		task = (await taskManager.waitFor(taskId, waitSeconds * 1000)) ?? task;
	}

	const lines = [
		`Task: ${task.id}`,
		`Kind: ${taskKind(task)}`,
		`Status: ${task.status}`,
		`Created: ${new Date(task.createdAt).toISOString()}`,
		`Due: ${new Date(task.dueAt).toISOString()}`,
	];
	if (task.kind === "prompt") {
		lines.push(`Prompt: ${task.prompt}`);
		if (task.endedAt) {
			const label = task.status === "delivered" ? "Delivered" : "Cancelled";
			lines.push(`${label}: ${new Date(task.endedAt).toISOString()}`);
		}
	} else {
		const durationStart = task.startedAt ?? task.createdAt;
		const durationMs = (task.endedAt ?? Date.now()) - durationStart;
		const snapshot = task.output.getSnapshot();
		lines.push(
			`PID: ${task.pid ?? "not started"}`,
			`Command: ${task.command}`,
			`Working Directory: ${task.cwd}`,
			`Duration: ${formatDuration(durationMs)}`,
			`Exit Code: ${task.exitCode ?? "null"}`,
		);
		if (task.monitor) {
			const limit = task.monitor.maxEvents === undefined ? "open-ended" : String(task.monitor.maxEvents);
			const delivery = isActive(task) ? (task.monitor.muted ? "silent until completion" : "active") : "finished";
			lines.push(`Monitor Events: ${task.monitor.deliveredEvents}/${limit}`, `Monitor Delivery: ${delivery}`);
		}
		lines.push("", `Output: ${snapshot.content || "(no output recorded yet)"}`);
		if (snapshot.truncated && snapshot.fullOutputPath) {
			lines.push(
				"",
				`[Truncated (${formatSize(DEFAULT_MAX_BYTES)} / ${DEFAULT_MAX_LINES} lines limit). Full output: ${snapshot.fullOutputPath}]`,
			);
		}
	}
	return {
		content: [{ type: "text" as const, text: lines.join("\n") }],
		details: {
			taskId: task.id,
			status: task.status,
			...(task.kind === "command" ? { exitCode: task.exitCode } : {}),
		},
	};
}

function cancelTask(taskManager: TaskManager, taskId: string | undefined) {
	if (!taskId) throw new Error("task_id is required for action: 'cancel'");
	const result = taskManager.cancel(taskId);
	return {
		content: [{ type: "text" as const, text: result.message }],
		details: { taskId, success: result.success },
	};
}

export function createTaskManagementTool(taskManager: TaskManager) {
	return defineTool<typeof taskParameters, TaskToolDetails>({
		name: "task",
		label: "task",
		description:
			"Manage scheduled prompts and commands, immediate background commands, and monitors: list tasks, inspect status and output, or cancel active work. Use wait_seconds with status to wait for completion or delivery.",
		promptSnippet: "Manage scheduled, background, or monitored tasks (list, inspect, wait, or cancel).",
		parameters: taskParameters,
		async execute(_toolCallId, params: TaskParameters) {
			switch (params.action) {
				case "list":
					return listTasks(taskManager);
				case "status":
					return taskStatus(taskManager, params.task_id, params.wait_seconds);
				case "cancel":
					return cancelTask(taskManager, params.task_id);
			}
		},
		renderCall(args, theme) {
			const action = args.action || "list";
			const target = args.task_id ? ` ${args.task_id}` : "";
			const wait = args.wait_seconds ? ` (wait ${args.wait_seconds}s)` : "";
			return new Text(theme.fg("toolTitle", theme.bold(`task ${action}${target}`)) + theme.fg("muted", wait), 0, 0);
		},
		renderResult(result, _options, theme) {
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";
			return new Text(theme.fg("toolOutput", text), 0, 0);
		},
	});
}
