import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { prepareShellCommand } from "./bash-tool.js";
import type { TaskManager } from "./task-manager.js";
import { type ScheduleParameters, type ScheduleToolDetails, scheduleParameters } from "./types.js";

function scheduledResult(taskId: string, kind: "prompt" | "command", dueAt: number, delaySeconds: number) {
	return {
		content: [
			{
				type: "text" as const,
				text: `Scheduled ${kind} as ${taskId} for ${new Date(dueAt).toISOString()} (in ${delaySeconds}s).`,
			},
		],
		details: {
			taskId,
			kind,
			status: "scheduled" as const,
			dueAt,
		},
	};
}

export function createScheduleTool(taskManager: TaskManager) {
	return defineTool<typeof scheduleParameters, ScheduleToolDetails>({
		name: "schedule",
		label: "schedule",
		description:
			"Schedule one self-authored prompt or bash command after a relative delay. A due prompt wakes the agent; a due command starts silently and wakes the agent only when it finishes. A zero-delay prompt is delivered after the active run settles. Scheduled work is session-local and managed with the task tool.",
		promptSnippet: "Schedule a one-shot prompt or bash command for later in this root session.",
		promptGuidelines: [
			"Use prompt to wake yourself with deferred guidance and command to run bash without an inference turn at start time.",
			"Use bash with run_in_background for commands that should start immediately.",
			"Scheduled work is cancelled on fork, tree navigation, session switch, or shutdown.",
		],
		parameters: scheduleParameters,
		executionMode: "sequential",
		async execute(_toolCallId, params: ScheduleParameters, signal, _onUpdate, ctx) {
			if (!Number.isFinite(params.delay_seconds) || params.delay_seconds < 0) {
				throw new Error("delay_seconds must be a finite non-negative number");
			}
			const hasPrompt = typeof params.prompt === "string";
			const hasCommand = typeof params.command === "string";
			if (hasPrompt === hasCommand) throw new Error("schedule requires exactly one prompt or command");

			const delayMs = params.delay_seconds * 1000;
			if (hasPrompt) {
				const task = taskManager.schedulePrompt(params.prompt!, delayMs);
				return scheduledResult(task.id, task.kind, task.dueAt, params.delay_seconds);
			}

			const prepared = await prepareShellCommand(process.cwd(), { command: params.command! }, signal, ctx, true);
			const task = taskManager.scheduleCommand(prepared.command, prepared.cwd, delayMs, prepared.start);
			return scheduledResult(task.id, task.kind, task.dueAt, params.delay_seconds);
		},
		renderCall(args, theme) {
			const kind = typeof args.prompt === "string" ? "prompt" : "command";
			return new Text(
				theme.fg("toolTitle", theme.bold(`schedule ${kind}`)) + theme.fg("muted", ` (in ${args.delay_seconds ?? 0}s)`),
				0,
				0,
			);
		},
		renderResult(result, _options, theme) {
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";
			return new Text(theme.fg("toolOutput", text), 0, 0);
		},
	});
}
