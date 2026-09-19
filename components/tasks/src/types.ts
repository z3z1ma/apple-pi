import { type Static, Type } from "typebox";
import type { OutputBuffer } from "./output-buffer.js";

export type TaskStatus = "scheduled" | "due" | "running" | "delivered" | "completed" | "failed" | "cancelled";

interface ManagedTaskBase {
	readonly id: string;
	readonly createdAt: number;
	readonly dueAt: number;
	endedAt?: number;
	status: TaskStatus;
}

export interface CommandTask extends ManagedTaskBase {
	readonly kind: "command";
	readonly command: string;
	readonly cwd: string;
	pid?: number;
	startedAt?: number;
	exitCode?: number | null;
	readonly output: OutputBuffer;
	detachedByOperator?: boolean;
}

export interface PromptTask extends ManagedTaskBase {
	readonly kind: "prompt";
	readonly prompt: string;
}

export type ManagedTask = CommandTask | PromptTask;
export type BackgroundTask = CommandTask;

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

export interface ScheduleToolDetails {
	taskId: string;
	kind: ManagedTask["kind"];
	status: TaskStatus;
	dueAt: number;
}

export const TASK_NOTIFICATION_CUSTOM_TYPE = "apple-pi.task-notification";
export const SCHEDULED_PROMPT_CUSTOM_TYPE = "apple-pi.scheduled-prompt";

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

export const scheduleParameters = Type.Object(
	{
		delay_seconds: Type.Number({
			minimum: 0,
			description: "Seconds to wait. Zero delivers a prompt after the active run settles.",
		}),
		prompt: Type.Optional(Type.String({ minLength: 1, description: "Self-authored prompt to deliver when due." })),
		command: Type.Optional(Type.String({ minLength: 1, description: "Bash command to start when due." })),
	},
	{
		additionalProperties: false,
		description: "Schedule exactly one self-authored prompt or bash command.",
		oneOf: [
			{ required: ["prompt"], not: { required: ["command"] } },
			{ required: ["command"], not: { required: ["prompt"] } },
		],
	},
);

export type ScheduleParameters = Static<typeof scheduleParameters>;

export const taskParameters = Type.Object({
	action: Type.Union([Type.Literal("list"), Type.Literal("status"), Type.Literal("cancel")], {
		description:
			"Action to perform: 'list' (list managed tasks), 'status' (get task details), 'cancel' (cancel scheduled or running work)",
	}),
	task_id: Type.Optional(
		Type.String({
			description: "Task ID (e.g. 'task-1'). Required for 'status' and 'cancel'.",
		}),
	),
	wait_seconds: Type.Optional(
		Type.Number({
			description: "Optional seconds to wait for active work when checking 'status'.",
		}),
	),
});

export type TaskParameters = Static<typeof taskParameters>;
