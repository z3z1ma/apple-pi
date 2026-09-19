import type { BackgroundTask } from "./types.js";

/**
 * Format a task notification message for the session transcript and agent wake-up.
 */
export function formatTaskNotification(task: BackgroundTask): string {
	const durationMs = (task.endedAt ?? Date.now()) - (task.startedAt ?? task.createdAt);
	const durationSec = Math.round((durationMs / 1000) * 10) / 10;
	const snapshot = task.output.getSnapshot();

	const lines = [
		`<task-notification id="${task.id}" status="${task.status}">`,
		`Task ${task.id} (${task.status}) finished in ${durationSec}s with exit code ${task.exitCode ?? "null"}.`,
		`Command: ${task.command}`,
	];

	if (snapshot.content.trim()) {
		lines.push("");
		lines.push("Output:");
		lines.push(snapshot.content.trim());
	}

	if (snapshot.fullOutputPath) {
		lines.push("");
		lines.push(`Full output: ${snapshot.fullOutputPath}`);
	}

	lines.push("");
	lines.push("</task-notification>");

	return lines.join("\n");
}
