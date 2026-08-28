import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

import { recallObservationTool } from "../../notebook/src/tools/notebook-source.js";
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
	const notebook = bindPrimarySession(recallObservationTool, sessionManager);
	const search = bindPrimarySession(sessionSearchTool, sessionManager);
	return [
		{
			...notebook,
			description:
				`${recallObservationTool.description} ` +
				"This revisits a note from your partner's session, never this side conversation.",
		},
		{
			...search,
			description: `${sessionSearchTool.description} This searches your partner's session, never this side conversation.`,
			promptGuidelines: [
				...(sessionSearchTool.promptGuidelines ?? []),
				"This searches your partner's session history, not this side conversation.",
			],
		},
	];
}
