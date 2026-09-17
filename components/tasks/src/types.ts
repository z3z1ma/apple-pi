import { type Static, Type } from "typebox";
import type { OutputBuffer } from "./output-buffer.js";

export type TaskStatus = "running" | "completed" | "failed" | "killed";

export interface BackgroundTask {
	readonly id: string;
	readonly command: string;
	readonly cwd: string;
	readonly pid: number;
	readonly startedAt: number;
	endedAt?: number;
	status: TaskStatus;
	exitCode?: number | null;
	readonly output: OutputBuffer;
	detachedByOperator?: boolean;
}

export interface TaskNotificationDetails {
	taskId: string;
	status: TaskStatus;
	exitCode?: number | null;
	command: string;
	durationMs: number;
	outputPreview?: string;
}

export interface TaskToolDetails {
	taskId?: string;
	status?: TaskStatus;
	exitCode?: number | null;
	success?: boolean;
}

export const TASK_NOTIFICATION_CUSTOM_TYPE = "apple-pi.task-notification";

export const bashParameters = Type.Object({
	command: Type.String({ description: "Shell command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
	stdin: Type.Optional(Type.String({ description: "Optional standard input to pass to the command" })),
	run_in_background: Type.Optional(
		Type.Boolean({
			description: "Run command in background detached from the current turn. Returns immediately with task ID.",
		}),
	),
	verbatim: Type.Optional(
		Type.Boolean({
			description:
				"Run command verbatim without RTK output compression or rewriting. Use when exact raw output or unfiltered flags are required.",
		}),
	),
});

export type BashParameters = Static<typeof bashParameters>;

export const execBashParameters = Type.Object({
	command: Type.String({ description: "Shell command to execute" }),
	timeout: Type.Optional(Type.Number({ description: "Timeout in seconds (optional, no default timeout)" })),
	stdin: Type.Optional(Type.String({ description: "Optional standard input to pass to the command" })),
});

export type ExecBashParameters = Static<typeof execBashParameters>;

export const taskParameters = Type.Object({
	action: Type.Union([Type.Literal("list"), Type.Literal("status"), Type.Literal("kill")], {
		description:
			"Action to perform: 'list' (list all background tasks), 'status' (get task status and recent output), 'kill' (terminate a task)",
	}),
	task_id: Type.Optional(
		Type.String({
			description: "Task ID (e.g. 'task-1'). Required for 'status' and 'kill'.",
		}),
	),
	wait_seconds: Type.Optional(
		Type.Number({
			description: "Optional seconds to wait for a running task when checking 'status'.",
		}),
	),
});

export type TaskParameters = Static<typeof taskParameters>;
