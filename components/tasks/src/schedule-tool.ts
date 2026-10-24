import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { prepareShellCommand } from "./bash-tool.js";
import type { TaskManager } from "./task-manager.js";
import {
	MAX_SCHEDULE_DELAY_SECONDS,
	type ScheduleParameters,
	type ScheduleToolDetails,
	scheduleParameters,
} from "./types.js";

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
		name: "remind_me",
		label: "remind_me",
		description:
			"Remind yourself later, after a relative delay: a note to yourself (text), or a bash command to start then. A due note steers you at once, entering an active run at its next safe boundary or starting a turn while idle; a due command starts silently and wakes you only when it finishes. Reminders live in this session and are managed with the task tool.",
		promptSnippet: "Remind yourself later with a note, or start a bash command later.",
		promptGuidelines: [
			"Use remind_me with text to wake yourself with deferred guidance, and with a command to start bash later without an inference turn.",
			"Scheduled work is cancelled on fork, tree navigation, session switch, or shutdown.",
		],
		parameters: scheduleParameters,
		executionMode: "sequential",
		async execute(_toolCallId, params: ScheduleParameters, signal, _onUpdate, ctx) {
			if (!Number.isFinite(params.delay_seconds) || params.delay_seconds < 0) {
				throw new Error("delay_seconds must be a finite non-negative number");
			}
			if (params.delay_seconds > MAX_SCHEDULE_DELAY_SECONDS) {
				throw new Error(`delay_seconds must be at most ${MAX_SCHEDULE_DELAY_SECONDS} (the platform timer limit)`);
			}
			const hasPrompt = typeof params.text === "string";
			const hasCommand = typeof params.command === "string";
			if (hasPrompt === hasCommand) throw new Error("remind_me requires exactly one text or command");

			const delayMs = params.delay_seconds * 1000;
			if (hasPrompt) {
				const task = taskManager.schedulePrompt(params.text!, delayMs);
				return scheduledResult(task.id, task.kind, task.dueAt, params.delay_seconds);
			}

			const prepared = await prepareShellCommand(process.cwd(), { command: params.command! }, signal, ctx, true, true);
			const task = taskManager.scheduleCommand(prepared.command, prepared.cwd, delayMs, prepared.start);
			return scheduledResult(task.id, task.kind, task.dueAt, params.delay_seconds);
		},
		renderCall(args, theme) {
			const kind = typeof args.text === "string" ? "note" : "command";
			return new Text(
				theme.fg("toolTitle", theme.bold(`remind_me ${kind}`)) + theme.fg("muted", ` (in ${args.delay_seconds ?? 0}s)`),
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
