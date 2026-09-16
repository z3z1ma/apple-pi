import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, defineTool, formatSize } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import type { TaskManager } from "./task-manager.js";
import { type TaskParameters, type TaskToolDetails, taskParameters } from "./types.js";

function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

export function createTaskManagementTool(taskManager: TaskManager) {
	return defineTool<typeof taskParameters, TaskToolDetails>({
		name: "task",
		label: "task",
		description:
			"Manage background tasks: list running/completed tasks, check status and output, or kill tasks. Use wait_seconds with status to wait for completion.",
		promptSnippet: "Manage background tasks (list, check status/output, or terminate).",
		parameters: taskParameters,
		async execute(_toolCallId, params: TaskParameters) {
			const { action, task_id, wait_seconds } = params;

			if (action === "list") {
				const tasks = taskManager.list();
				if (tasks.length === 0) {
					return {
						content: [{ type: "text" as const, text: "No background tasks found." }],
						details: {},
					};
				}

				const lines = [
					"Background tasks:",
					"",
					"ID       STATUS     PID     DURATION  EXIT  COMMAND",
					"----------------------------------------------------------------------",
				];

				for (const task of tasks) {
					const durationMs = (task.endedAt ?? Date.now()) - task.startedAt;
					const duration = formatDuration(durationMs).padEnd(9);
					const id = task.id.padEnd(8);
					const status = task.status.padEnd(10);
					const pid = String(task.pid).padEnd(7);
					const exitCode =
						task.exitCode !== undefined && task.exitCode !== null ? String(task.exitCode).padEnd(5) : "-    ";
					const cmd = task.command.length > 50 ? `${task.command.slice(0, 47)}...` : task.command;
					lines.push(`${id} ${status} ${pid} ${duration} ${exitCode} ${cmd}`);
				}

				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
					details: {},
				};
			}

			if (action === "status") {
				if (!task_id) {
					throw new Error("task_id is required for action: 'status'");
				}

				let task = taskManager.get(task_id);
				if (!task) {
					throw new Error(`Task '${task_id}' not found`);
				}

				if (wait_seconds && wait_seconds > 0 && task.status === "running") {
					task = (await taskManager.waitFor(task_id, wait_seconds * 1000)) ?? task;
				}

				const durationMs = (task.endedAt ?? Date.now()) - task.startedAt;
				const snapshot = task.output.getSnapshot();

				const lines = [
					`Task: ${task.id}`,
					`Status: ${task.status}`,
					`PID: ${task.pid}`,
					`Command: ${task.command}`,
					`Working Directory: ${task.cwd}`,
					`Duration: ${formatDuration(durationMs)}`,
					`Exit Code: ${task.exitCode ?? "null"}`,
				];

				if (snapshot.content) {
					lines.push("");
					lines.push("Output:");
					lines.push(snapshot.content);
				} else {
					lines.push("");
					lines.push("Output: (no output recorded yet)");
				}

				if (snapshot.truncated && snapshot.fullOutputPath) {
					lines.push("");
					lines.push(
						`[Truncated (${formatSize(DEFAULT_MAX_BYTES)} / ${DEFAULT_MAX_LINES} lines limit). Full output: ${snapshot.fullOutputPath}]`,
					);
				}

				return {
					content: [{ type: "text" as const, text: lines.join("\n") }],
					details: {
						taskId: task.id,
						status: task.status,
						exitCode: task.exitCode,
					},
				};
			}

			if (action === "kill") {
				if (!task_id) {
					throw new Error("task_id is required for action: 'kill'");
				}

				const result = taskManager.kill(task_id);
				return {
					content: [{ type: "text" as const, text: result.message }],
					details: {
						taskId: task_id,
						success: result.success,
					},
				};
			}

			throw new Error(`Unknown action: '${action}'`);
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
