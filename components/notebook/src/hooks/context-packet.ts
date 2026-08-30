import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { Runtime } from "../runtime.js";
import { buildCompactionProjection, type Entry, renderSummary } from "../session-ledger/index.js";

export const NOTEBOOK_PACKET_CUSTOM_TYPE = "notebook.packet";
export const NOTEBOOK_PACKET_HEADER = "## Pair Notebook";

export function latestCompactionBoundary(entries: Entry[]): string | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type !== "compaction") continue;
		return entry.firstKeptEntryId || entries.at(-1)?.id;
	}
	return undefined;
}

export function messageHasNotebookPacket(message: unknown): boolean {
	if (message === null || typeof message !== "object") return false;
	const record = message as { customType?: unknown; content?: unknown };
	if (record.customType === NOTEBOOK_PACKET_CUSTOM_TYPE) return true;
	if (typeof record.content === "string") return record.content.includes(NOTEBOOK_PACKET_HEADER);
	if (!Array.isArray(record.content)) return false;
	return record.content.some((part) => {
		const text = typeof part === "object" && part !== null ? (part as { text?: unknown }).text : undefined;
		return typeof text === "string" && text.includes(NOTEBOOK_PACKET_HEADER);
	});
}

export function buildNotebookContextPacket(
	entries: Entry[],
	observationsPoolMaxTokens: number,
): { customType: string; content: Array<{ type: "text"; text: string }> } | undefined {
	const boundaryId = latestCompactionBoundary(entries);
	if (!boundaryId) return undefined;

	const projection = buildCompactionProjection(entries, boundaryId, { observationsPoolMaxTokens });
	const notebookSummary = renderSummary(projection.reflections, projection.observations);
	if (!notebookSummary.trim()) return undefined;

	return {
		customType: NOTEBOOK_PACKET_CUSTOM_TYPE,
		content: [{ type: "text", text: `${NOTEBOOK_PACKET_HEADER}\n\n${notebookSummary}` }],
	};
}

/**
 * After any compaction, append the current Pair notebook packet to the
 * live conversation tail. Covers xAI server-side compaction, Pi default
 * summarization, and every compact-hook fallback that still writes a compaction
 * entry.
 */
export function registerNotebookContextPacket(pi: ExtensionAPI, notebook: Runtime): void {
	pi.on("context", (event, ctx) => {
		const branchEntries = (ctx.sessionManager?.getBranch?.() ?? []) as Entry[];
		notebook.ensureConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);
		const packet = buildNotebookContextPacket(branchEntries, notebook.config.observationsPoolMaxTokens);
		if (!packet) return undefined;

		const messages = event.messages ?? [];
		if (messages.some((message) => messageHasNotebookPacket(message))) return undefined;

		return {
			messages: [
				...messages,
				{
					role: "custom" as const,
					customType: packet.customType,
					content: packet.content,
					display: false,
					timestamp: Date.now(),
				},
			],
		};
	});
}
