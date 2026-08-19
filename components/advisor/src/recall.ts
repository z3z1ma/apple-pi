import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

import { recallObservationTool } from "../../memory/src/tools/recall-observation.js";
import { sessionSearchTool } from "../../session-search/src/index.js";

export type PrimarySessionManager = Pick<
	ExtensionContext["sessionManager"],
	"getSessionFile" | "getBranch" | "getEntries"
>;

function bindPrimarySession(
	tool: ToolDefinition<any, any, any>,
	sessionManager: PrimarySessionManager,
): ToolDefinition {
	return {
		...tool,
		execute(toolCallId, params, signal, onUpdate, ctx) {
			return tool.execute(toolCallId, params, signal, onUpdate, {
				...ctx,
				sessionManager: sessionManager as ExtensionContext["sessionManager"],
			});
		},
	};
}

export function bindPrimaryRecallTools(sessionManager: PrimarySessionManager): ToolDefinition[] {
	const memory = bindPrimarySession(recallObservationTool, sessionManager);
	const search = bindPrimarySession(sessionSearchTool, sessionManager);
	return [
		{
			...memory,
			description:
				`${recallObservationTool.description} ` +
				"Resolves against the primary implementing-agent session, never this advisor conversation.",
		},
		{
			...search,
			description:
				`${sessionSearchTool.description} ` +
				"Searches the primary implementing-agent session, never this advisor conversation.",
			promptGuidelines: [
				...(sessionSearchTool.promptGuidelines ?? []),
				"This searches the primary session transcript, not the advisor conversation.",
			],
		},
	];
}
