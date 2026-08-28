import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { Runtime } from "../runtime.js";
import { buildCompactionProjection, type Entry, renderSummary } from "../session-ledger/index.js";

export const MEMORY_PACKET_CUSTOM_TYPE = "om.memory.packet";
export const MEMORY_PACKET_HEADER = "## Observational Memory";

export function latestCompactionBoundary(entries: Entry[]): string | undefined {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry?.type !== "compaction") continue;
		return entry.firstKeptEntryId || entries.at(-1)?.id;
	}
	return undefined;
}

export function messageHasMemoryPacket(message: unknown): boolean {
	if (message === null || typeof message !== "object") return false;
	const record = message as { customType?: unknown; content?: unknown };
	if (record.customType === MEMORY_PACKET_CUSTOM_TYPE) return true;
	if (typeof record.content === "string") return record.content.includes(MEMORY_PACKET_HEADER);
	if (!Array.isArray(record.content)) return false;
	return record.content.some((part) => {
		const text = typeof part === "object" && part !== null ? (part as { text?: unknown }).text : undefined;
		return typeof text === "string" && text.includes(MEMORY_PACKET_HEADER);
	});
}

export function buildMemoryContextPacket(
	entries: Entry[],
	observationsPoolMaxTokens: number,
): { customType: string; content: Array<{ type: "text"; text: string }> } | undefined {
	const boundaryId = latestCompactionBoundary(entries);
	if (!boundaryId) return undefined;

	const projection = buildCompactionProjection(entries, boundaryId, { observationsPoolMaxTokens });
	const memorySummary = renderSummary(projection.reflections, projection.observations);
	if (!memorySummary.trim()) return undefined;

	return {
		customType: MEMORY_PACKET_CUSTOM_TYPE,
		content: [{ type: "text", text: `${MEMORY_PACKET_HEADER}\n\n${memorySummary}` }],
	};
}

/**
 * After any compaction, append the current Pair memory packet to the
 * live conversation tail. Covers xAI server-side compaction, Pi default
 * summarization, and every compact-hook fallback that still writes a compaction
 * entry.
 */
export function registerMemoryContextPacket(pi: ExtensionAPI, memory: Runtime): void {
	pi.on("context", (event, ctx) => {
		const branchEntries = (ctx.sessionManager?.getBranch?.() ?? []) as Entry[];
		memory.ensureConfig(ctx.cwd);
		const packet = buildMemoryContextPacket(branchEntries, memory.config.observationsPoolMaxTokens);
		if (!packet) return undefined;

		const messages = event.messages ?? [];
		if (messages.some((message) => messageHasMemoryPacket(message))) return undefined;

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
