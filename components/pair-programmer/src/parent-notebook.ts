import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	messageHasNotebookPacket,
	NOTEBOOK_PACKET_CUSTOM_TYPE,
	NOTEBOOK_PACKET_HEADER,
} from "../../notebook/src/hooks/context-packet.js";
import { fullProjection } from "../../notebook/src/session-ledger/index.js";
import { observationToSummaryLine, reflectionToSummaryLine } from "../../notebook/src/session-ledger/render-summary.js";
import type { Entry } from "../../notebook/src/session-ledger/types.js";

import type { PrimarySessionManager } from "./recall.js";

const PARENT_NOTEBOOK_FRAMING = `This is the sourced notebook you keep for your partner's session, not a notebook for this side conversation.

- Reflections capture the pair's current shared understanding of the user, project, decisions, constraints, completed outcomes, and pivots that still shape the work. Their ids appear in brackets.
- Observations preserve working evidence that still matters in detail. They are timestamped, chronological, and include ids in brackets.

Use the current understanding rather than replaying the notebook as a historical stack. When a newer observation conflicts with a reflection, the observation is the latest known state until you revise the reflection.

Use revisit_note with a relevant observation or reflection id when you need its exact source context. Use expand_receipt only with a handle already shown in your shared trajectory when you need a folded payload. Both tools open evidence from your partner's primary session.`;

export function buildParentNotebookPacket(
	primaryEntries: readonly unknown[],
): { customType: string; content: Array<{ type: "text"; text: string }> } | undefined {
	try {
		const projection = fullProjection(primaryEntries as Entry[]);
		if (projection.reflections.length === 0 && projection.observations.length === 0) return undefined;

		const parts = [PARENT_NOTEBOOK_FRAMING];
		if (projection.reflections.length > 0) {
			parts.push(`## Reflections\n${projection.reflections.map(reflectionToSummaryLine).join("\n")}`);
		}
		if (projection.observations.length > 0) {
			parts.push(`## Observations\n${projection.observations.map(observationToSummaryLine).join("\n")}`);
		}

		return {
			customType: NOTEBOOK_PACKET_CUSTOM_TYPE,
			content: [{ type: "text", text: `${NOTEBOOK_PACKET_HEADER}\n\n${parts.join("\n\n")}` }],
		};
	} catch {
		return undefined;
	}
}

export function insertParentNotebookAfterCompaction(
	messages: readonly AgentMessage[],
	packet: { customType: string; content: Array<{ type: "text"; text: string }> },
): { messages: AgentMessage[] } | undefined {
	if (messages.some((message) => messageHasNotebookPacket(message))) return undefined;
	const compactIndex = messages.findIndex((message) => message.role === "compactionSummary");
	if (compactIndex === -1) return undefined;

	const next = [...messages];
	next.splice(compactIndex + 1, 0, {
		role: "custom" as const,
		customType: packet.customType,
		content: packet.content,
		display: false,
		timestamp: Date.now(),
	});
	return { messages: next };
}

/**
 * After the pair session compacts, append the implementing agent's live fold
 * immediately after the compaction summary. Recall tools stay on the session
 * allowlist and resolve against the primary manager.
 */
export function registerPairParentNotebookPacket(pi: ExtensionAPI, primarySessionManager: PrimarySessionManager): void {
	pi.on("context", (event) => {
		const primaryEntries = primarySessionManager.getBranch?.() ?? primarySessionManager.getEntries?.() ?? [];
		const packet = buildParentNotebookPacket(primaryEntries);
		if (!packet) return undefined;
		return insertParentNotebookAfterCompaction(event.messages ?? [], packet);
	});
}
