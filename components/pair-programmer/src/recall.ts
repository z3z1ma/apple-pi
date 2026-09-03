import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

import { recallNotebookSources } from "../../notebook/src/session-ledger/recall.js";
import type { Entry } from "../../notebook/src/session-ledger/types.js";
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

export function bindPairRecallTools(sessionManager: PrimarySessionManager): ToolDefinition[] {
	const notebook = bindPrimarySession(recallObservationTool, sessionManager);
	return [
		{
			...notebook,
			description:
				`${recallObservationTool.description} ` +
				"This revisits a known note from your partner's session, never this side conversation.",
			promptGuidelines: [
				"Use revisit_note only with a known notebook id when its exact primary-session source materially affects your judgment.",
				"This follows one sourced notebook entry; it is neither topic search nor repository navigation.",
			],
			async execute(toolCallId, params, signal, onUpdate, ctx) {
				const result = await notebook.execute(toolCallId, params, signal, onUpdate, ctx);
				const entries = sessionManager.getBranch() as Entry[];
				const recalled = recallNotebookSources(entries, (params as { id: string }).id);
				if (recalled.status !== "found") return result;
				for (const entry of recalled.sourceEntries) {
					const content = (entry.message as { content?: unknown } | undefined)?.content;
					if (!Array.isArray(content)) continue;
					const images = content.filter(
						(part): part is { type: "image"; data: string; mimeType: string } =>
							part?.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string",
					);
					if (images.length === 0) continue;
					result.content.push({ type: "text", text: `[Images from source entry id: ${entry.id}]` }, ...images);
				}
				return result;
			},
		},
	];
}

export function bindPrimaryRecallTools(sessionManager: PrimarySessionManager): ToolDefinition[] {
	const search = bindPrimarySession(sessionSearchTool, sessionManager);
	return [
		...bindPairRecallTools(sessionManager),
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
