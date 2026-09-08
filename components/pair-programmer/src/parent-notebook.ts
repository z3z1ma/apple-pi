import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	messageHasNotebookPacket,
	NOTEBOOK_PACKET_CUSTOM_TYPE,
	NOTEBOOK_PACKET_HEADER,
} from "../../notebook/src/hooks/context-packet.js";
import { foldLedger } from "../../notebook/src/session-ledger/fold.js";
import { reflectionToSummaryLine } from "../../notebook/src/session-ledger/render-summary.js";
import type { Entry } from "../../notebook/src/session-ledger/types.js";

import type { PrimarySessionManager } from "./recall.js";

const PARENT_NOTEBOOK_FRAMING = `This is the notebook of working conclusions you keep for your partner's session, not a notebook for this side conversation.

- Working conclusions are revisable, scoped understandings that should still change how the pair proceeds. Their ids appear in brackets.
- This current view replaces earlier notebook snapshots. User direction and current evidence take precedence. An empty notebook is a successful outcome.

Use revisit_note with a relevant conclusion id when you need its exact source context. Use expand_receipt only with a handle already shown in your shared trajectory when you need a folded payload. Both tools open evidence from your partner's primary session.`;

export function buildParentNotebookPacket(
	primaryEntries: readonly unknown[],
): { customType: string; content: Array<{ type: "text"; text: string }> } | undefined {
	try {
		const folded = foldLedger(primaryEntries as Entry[]);
		if (folded.currentReflections.length === 0) return undefined;

		const parts = [
			PARENT_NOTEBOOK_FRAMING,
			`## Working conclusions\n${folded.currentReflections.map(reflectionToSummaryLine).join("\n")}`,
		];

		return {
			customType: NOTEBOOK_PACKET_CUSTOM_TYPE,
			content: [{ type: "text", text: `${NOTEBOOK_PACKET_HEADER}\n\n${parts.join("\n\n")}` }],
		};
	} catch {
		return undefined;
	}
}

export function refreshParentNotebookPacket(
	messages: readonly AgentMessage[],
	packet: { customType: string; content: Array<{ type: "text"; text: string }> } | undefined,
): { messages: AgentMessage[] } {
	const next = messages.filter((message) => !messageHasNotebookPacket(message));
	if (!packet) return { messages: next };
	next.push({
		role: "custom" as const,
		customType: packet.customType,
		content: packet.content,
		display: false,
		timestamp: Date.now(),
	});
	return { messages: next };
}

/** Keep shared conclusions current even when either programmer revises them between compactions. */
export function registerPairParentNotebookPacket(pi: ExtensionAPI, primarySessionManager: PrimarySessionManager): void {
	pi.on("context", (event) => {
		const primaryEntries = primarySessionManager.getBranch?.() ?? primarySessionManager.getEntries?.() ?? [];
		const packet = buildParentNotebookPacket(primaryEntries);
		return refreshParentNotebookPacket(event.messages ?? [], packet);
	});
}
