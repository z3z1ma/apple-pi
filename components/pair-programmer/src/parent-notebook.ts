import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	NOTEBOOK_PACKET_CUSTOM_TYPE,
	NOTEBOOK_PACKET_HEADER,
	messageHasNotebookPacket,
} from "../../notebook/src/hooks/context-packet.js";
import { fullProjection } from "../../notebook/src/session-ledger/index.js";
import { observationToSummaryLine, reflectionToSummaryLine } from "../../notebook/src/session-ledger/render-summary.js";
import type { Entry } from "../../notebook/src/session-ledger/types.js";

import type { PrimarySessionManager } from "./recall.js";

const PARENT_NOTEBOOK_FRAMING = `This is the Pair Programmer's notebook for the implementing-agent session, not a notebook for this pair conversation.

- Reflections: current law on that session. Binding facts about the user, project, decisions, constraints, completed outcomes, and still-constraining pivots. Reflection lines include ids in brackets.
- Observations: working evidence still needed as detail. Timestamped, in chronological order, with ids in brackets.

Honor current law. Do not replay this list as a historical stack. When current law and a newer observation conflict, the newer observation is the latest known state until law is updated.

When exact source context is needed, use notebook_source with the relevant observation or reflection id. To search the implementing-agent transcript or recover a file written earlier, use session_search. Both tools resolve against the primary session, never this pair conversation.`;

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
