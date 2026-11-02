import type { Message } from "@earendil-works/pi-ai";
import { executionOperationsOf } from "./execution-trace.js";
import type { RenderedEntry } from "./render-entries.js";

export interface RecallFilter {
	after?: string;
	before?: string;
	role?: string;
	tool?: string;
	source?: string;
}

const ROLES = new Set([
	"user",
	"assistant",
	"tool_result",
	"bash",
	"custom_message",
	"compaction",
	"branch_summary",
	"notebook",
]);
const SOURCES = new Set(["message", "custom_message", "compaction", "branch_summary", "notebook"]);

export const validateRecallFilter = (filter?: RecallFilter): void => {
	if (!filter) return;
	for (const key of ["after", "before"] as const) {
		const value = filter[key];
		if (value === undefined) continue;
		if (
			typeof value !== "string" ||
			!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value) ||
			!Number.isFinite(Date.parse(value)) ||
			!new Date(value.slice(0, 10)).toISOString().startsWith(value.slice(0, 10))
		)
			throw new Error(`Invalid filter.${key}: use an ISO date or timestamp with timezone.`);
	}
	if (filter.after && filter.before && Date.parse(filter.after) >= Date.parse(filter.before))
		throw new Error("Invalid date filter: after must be earlier than before.");
	if (filter.role !== undefined && !ROLES.has(filter.role))
		throw new Error(`Invalid filter.role: choose ${[...ROLES].join(", ")}.`);
	if (filter.source !== undefined && !SOURCES.has(filter.source))
		throw new Error(`Invalid filter.source: choose ${[...SOURCES].join(", ")}.`);
	if (filter.tool !== undefined && (typeof filter.tool !== "string" || !filter.tool.trim()))
		throw new Error("Invalid filter.tool: use an exact tool name.");
};

export const matchesRecallFilter = (entry: RenderedEntry, message: Message, filter?: RecallFilter): boolean => {
	if (!filter) return true;
	if (filter.role && entry.role !== filter.role) return false;
	if (filter.source && (entry.sourceKind ?? "message") !== filter.source) return false;
	const timestamp = Date.parse(entry.timestamp ?? "");
	if (filter.after && !(timestamp >= Date.parse(filter.after))) return false;
	if (filter.before && !(timestamp < Date.parse(filter.before))) return false;
	if (!filter.tool) return true;
	if (
		message.role === "toolResult" &&
		(message.toolName === filter.tool ||
			executionOperationsOf((message as any).details).some((operation) => operation.name === filter.tool))
	)
		return true;
	return (
		Array.isArray(message.content) &&
		message.content.some((part) => part.type === "toolCall" && part.name === filter.tool)
	);
};
