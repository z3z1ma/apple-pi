import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import type { Runtime } from "../runtime.js";
import { type Entry, foldLedger, renderSummary } from "../session-ledger/index.js";

export const NOTEBOOK_PACKET_CUSTOM_TYPE = "notebook.packet";
export const NOTEBOOK_PACKET_HEADER = "## Pair programmer notebook";

export function messageHasNotebookPacket(message: unknown): boolean {
	if (message === null || typeof message !== "object") return false;
	return (message as { customType?: unknown }).customType === NOTEBOOK_PACKET_CUSTOM_TYPE;
}

export function buildNotebookContextPacket(
	entries: Entry[],
): { customType: string; content: Array<{ type: "text"; text: string }> } | undefined {
	const notebookSummary = renderSummary(foldLedger(entries).currentReflections);
	if (!notebookSummary.trim()) return undefined;

	return {
		customType: NOTEBOOK_PACKET_CUSTOM_TYPE,
		content: [{ type: "text", text: `${NOTEBOOK_PACKET_HEADER}\n\n${notebookSummary}` }],
	};
}

/** Rebuild live guidance from the active branch, including corrections made since compaction. */
export function registerNotebookContextPacket(pi: ExtensionAPI, notebook: Runtime): void {
	pi.on("context", (event, ctx) => {
		const branchEntries = (ctx.sessionManager?.getBranch?.() ?? []) as Entry[];
		notebook.ensureConfig(ctx.cwd, ctx.isProjectTrusted?.() ?? false);
		const packet = buildNotebookContextPacket(branchEntries);
		const messages = (event.messages ?? []).filter((message) => !messageHasNotebookPacket(message));
		if (!packet) return { messages };

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
