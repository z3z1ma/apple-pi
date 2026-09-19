import { defineTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { prepareShellCommand } from "./bash-tool.js";
import type { TaskManager } from "./task-manager.js";
import { type MonitorParameters, type MonitorToolDetails, monitorParameters } from "./types.js";

export function createMonitorTool(taskManager: TaskManager) {
	return defineTool<typeof monitorParameters, MonitorToolDetails>({
		name: "monitor",
		label: "monitor",
		description:
			"Start a managed shell event source immediately. Every newline-terminated stdout line steers the agent at Pi's next safe model boundary while the command keeps running. Stderr and unterminated stdout remain task output. max_events optionally stops event delivery after its final announced event without stopping the command. Monitor commands run verbatim and remain inspectable or cancellable with task.",
		promptSnippet: "Monitor a command whose meaningful stdout lines should reactively steer the root agent.",
		promptGuidelines: [
			"Choose root execution by intent: use bash for immediate work, bash with run_in_background for finite work that should wake only on completion, schedule for a prompt or command that should start later, monitor for a continuing command whose stdout should steer the run, and task to inspect or cancel managed work.",
			"Treat monitor commands as event programs: every newline-terminated stdout line immediately steers you. Make each line meaningful, redirect or suppress noise, and use line-buffered or unbuffered producers such as grep --line-buffered, awk with fflush(), or jq --unbuffered.",
			"Set monitor max_events when the workflow has a natural notification limit. Its final event announces silent-until-completion mode; omit max_events when an open-ended event stream is appropriate.",
		],
		parameters: monitorParameters,
		executionMode: "sequential",
		async execute(_toolCallId, params: MonitorParameters, signal, _onUpdate, ctx) {
			if (params.max_events !== undefined && (!Number.isSafeInteger(params.max_events) || params.max_events < 1)) {
				throw new Error("max_events must be a positive integer");
			}
			const prepared = await prepareShellCommand(process.cwd(), { command: params.command }, signal, ctx, false);
			const task = taskManager.createMonitor(prepared.command, prepared.cwd, prepared.start, params.max_events);
			const limit = params.max_events === undefined ? "open-ended" : `limited to ${params.max_events}`;
			return {
				content: [
					{
						type: "text",
						text:
							`Monitor started as ${task.id} (PID ${task.pid}, ${limit}). ` +
							"Each completed stdout line will steer the agent. Use task to inspect or cancel it.",
					},
				],
				details: {
					taskId: task.id,
					pid: task.pid,
					status: task.status,
					maxEvents: params.max_events,
				},
			};
		},
		renderCall(args, theme) {
			const limit = args.max_events === undefined ? "" : ` (max ${args.max_events})`;
			return new Text(
				theme.fg("toolTitle", theme.bold(`monitor ${args.command ?? "..."}`)) + theme.fg("muted", limit),
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
