import type { ManagedTask, MonitorEvent } from "./types.js";

/**
 * Format a task notification message for the session transcript and agent wake-up.
 */
export function formatTaskNotification(task: ManagedTask): string {
	const startedAt = task.kind === "command" ? (task.startedAt ?? task.createdAt) : task.createdAt;
	const durationMs = (task.endedAt ?? Date.now()) - startedAt;
	const durationSec = Math.round((durationMs / 1000) * 10) / 10;
	const label = task.kind === "prompt" ? "Prompt" : task.monitor ? "Monitor" : "Task";
	const subject = task.kind === "prompt" ? `Prompt: ${task.prompt}` : `Command: ${task.command}`;
	const outcome =
		task.kind === "command"
			? `${label} ${task.id} (${task.status}) finished in ${durationSec}s with exit code ${task.exitCode ?? "null"}.`
			: `${label} ${task.id} (${task.status}) finished in ${durationSec}s.`;
	const lines = [`<task-notification id="${task.id}" status="${task.status}">`, outcome, subject];

	if (task.kind === "command") {
		const snapshot = task.output.getSnapshot();
		if (snapshot.content.trim()) lines.push("", "Output:", snapshot.content.trim());
		if (snapshot.fullOutputPath) lines.push("", `Full output: ${snapshot.fullOutputPath}`);
	}

	lines.push("", "</task-notification>");
	return lines.join("\n");
}

export function formatMonitorEvent(event: MonitorEvent): string {
	const { task, line, eventIndex, reachedLimit } = event;
	const limit = task.monitor?.maxEvents;
	const attributes = [`id="${task.id}"`, `event="${eventIndex}"`];
	if (limit !== undefined) attributes.push(`max-events="${limit}"`);
	const lines = [`<monitor-event ${attributes.join(" ")}>`, line];
	if (reachedLimit) {
		lines.push(
			"",
			`Monitor ${task.id} has reached its ${limit}-event delivery limit. The command will continue silently until it completes or fails. Use task status or cancel when needed.`,
		);
	}
	lines.push("</monitor-event>");
	return lines.join("\n");
}
