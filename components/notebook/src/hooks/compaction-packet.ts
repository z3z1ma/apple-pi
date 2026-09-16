import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { type Entry, foldLedger, renderSummary } from "../session-ledger/index.js";

export const NOTEBOOK_PACKET_CUSTOM_TYPE = "notebook.packet";
export const NOTEBOOK_PACKET_HEADER = "## Pair programmer notebook";

export function buildNotebookPacket(
	entries: Entry[],
): { customType: string; content: Array<{ type: "text"; text: string }> } | undefined {
	const notebookSummary = renderSummary(foldLedger(entries).currentReflections);
	if (!notebookSummary.trim()) return undefined;

	return {
		customType: NOTEBOOK_PACKET_CUSTOM_TYPE,
		content: [{ type: "text", text: `${NOTEBOOK_PACKET_HEADER}\n\n${notebookSummary}` }],
	};
}

/**
 * Land current conclusions once after each compaction as a persisted message.
 * It then stays byte-identical in history, so provider prefix caches keep
 * matching. Rebuilding or moving it per request re-sends the whole prefix.
 */
export function registerNotebookCompactionPacket(pi: ExtensionAPI): void {
	pi.on("session_compact", (_event, ctx) => {
		const packet = buildNotebookPacket((ctx.sessionManager?.getBranch?.() ?? []) as Entry[]);
		if (!packet) return;
		pi.sendMessage(
			{ customType: packet.customType, content: packet.content, display: false },
			{ deliverAs: "steer", triggerTurn: false },
		);
	});
}
