import { getStatusNote } from "./status-note.js";
import type { AgentRecord, NotificationDetails } from "./types.js";
import {
	buildInvocationTags,
	type AgentActivity,
	type AgentDetails,
	formatTokens,
	getDisplayName,
} from "./ui/agent-widget.js";
import { getLifetimeTotal } from "./usage.js";

export function statusLabel(record: Pick<AgentRecord, "status" | "error" | "terminationCause">): string {
	const cause = record.terminationCause;
	if (cause === "token_ceiling") return "Stopped (token ceiling)";
	if (cause === "turn_ceiling")
		return record.status === "steered" ? "Wrapped up (turn ceiling)" : "Aborted (turn ceiling)";
	if (cause === "compaction") return "Stopped (compacted)";
	if (cause === "operator_stop") return "Stopped by the operator";
	if (cause === "external_cancellation") return "Cancelled by the caller";
	if (cause === "provider_error") return `Provider error: ${record.error ?? "unknown"}`;
	switch (record.status) {
		case "error":
			return `Error: ${record.error ?? "unknown"}`;
		case "aborted":
			return "Aborted";
		case "steered":
			return "Wrapped up";
		case "stopped":
			return "Stopped";
		default:
			return "Done";
	}
}

function escapeXml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatNotification(record: AgentRecord, maxLength: number): string {
	const output = record.result || record.error || "No output.";
	const preview =
		output.length > maxLength
			? `${output.slice(0, maxLength)}\n...(truncated; use get_subagent_result for full output)`
			: output;
	return [
		"<task-notification>",
		`<task-id>${record.id}</task-id>`,
		record.toolCallId ? `<tool-use-id>${escapeXml(record.toolCallId)}</tool-use-id>` : undefined,
		record.sessionFile ? `<session-file>${escapeXml(record.sessionFile)}</session-file>` : undefined,
		`<status>${escapeXml(statusLabel(record))}</status>`,
		`<summary>Agent "${escapeXml(record.description)}" ${record.status}${getStatusNote(record.status)}</summary>`,
		`<result>${escapeXml(preview)}</result>`,
		`<usage><total_tokens>${getLifetimeTotal(record.lifetimeUsage)}</total_tokens><tool_uses>${record.toolUses}</tool_uses><compactions>${record.compactionCount}</compactions></usage>`,
		"</task-notification>",
	]
		.filter(Boolean)
		.join("\n");
}

export function notificationDetails(
	record: AgentRecord,
	maxLength: number,
	activity?: AgentActivity,
): NotificationDetails {
	const output = record.result || record.error || "No output.";
	return {
		id: record.id,
		description: record.description,
		status: record.status,
		toolUses: record.toolUses,
		turnCount: activity?.turnCount ?? 0,
		maxTurns: activity?.maxTurns,
		totalTokens: getLifetimeTotal(record.lifetimeUsage),
		durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
		error: record.error,
		resultPreview: output.length > maxLength ? `${output.slice(0, maxLength)}…` : output,
	};
}

export function detailsFor(
	record: AgentRecord,
	activity?: AgentActivity,
	overrides: Partial<AgentDetails> = {},
): AgentDetails {
	const tags = buildInvocationTags(record.invocation);
	return {
		displayName: getDisplayName(record.type),
		description: record.description,
		subagentType: record.type,
		toolUses: record.toolUses,
		tokens: formatTokens(getLifetimeTotal(record.lifetimeUsage)),
		durationMs: (record.completedAt ?? Date.now()) - record.startedAt,
		status: record.status,
		modelName: tags.modelName,
		tags: tags.tags,
		turnCount: activity?.turnCount,
		maxTurns: activity?.maxTurns,
		agentId: record.id,
		sessionFile: record.sessionFile,
		error: record.error,
		...overrides,
	};
}
