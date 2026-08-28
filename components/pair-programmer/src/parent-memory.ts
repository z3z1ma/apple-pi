import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import {
	MEMORY_PACKET_CUSTOM_TYPE,
	MEMORY_PACKET_HEADER,
	messageHasMemoryPacket,
} from "../../memory/src/hooks/context-packet.js";
import { fullProjection } from "../../memory/src/session-ledger/index.js";
import { observationToSummaryLine, reflectionToSummaryLine } from "../../memory/src/session-ledger/render-summary.js";
import type { Entry } from "../../memory/src/session-ledger/types.js";

import type { PrimarySessionManager } from "./recall.js";

const PARENT_MEMORY_FRAMING = `These records are the implementing-agent session's current working memory, not this pair conversation.

- Reflections: current law on that session. Binding facts about the user, project, decisions, constraints, completed outcomes, and still-constraining pivots. Reflection lines include ids in brackets.
- Observations: working evidence still needed as detail. Timestamped, in chronological order, with ids in brackets.

Honor current law. Do not replay this list as a historical stack. When current law and a newer observation conflict, the newer observation is the latest known state until law is updated.

When exact source context is needed, use memory_source with the relevant observation or reflection id. To search the implementing-agent transcript or recover a file written earlier, use session_search. Both tools resolve against the primary session, never this pair conversation.`;

export function buildParentMemoryPacket(
	primaryEntries: readonly unknown[],
): { customType: string; content: Array<{ type: "text"; text: string }> } | undefined {
	try {
		const projection = fullProjection(primaryEntries as Entry[]);
		if (projection.reflections.length === 0 && projection.observations.length === 0) return undefined;

		const parts = [PARENT_MEMORY_FRAMING];
		if (projection.reflections.length > 0) {
			parts.push(`## Reflections\n${projection.reflections.map(reflectionToSummaryLine).join("\n")}`);
		}
		if (projection.observations.length > 0) {
			parts.push(`## Observations\n${projection.observations.map(observationToSummaryLine).join("\n")}`);
		}

		return {
			customType: MEMORY_PACKET_CUSTOM_TYPE,
			content: [{ type: "text", text: `${MEMORY_PACKET_HEADER}\n\n${parts.join("\n\n")}` }],
		};
	} catch {
		return undefined;
	}
}

export function insertParentMemoryAfterCompaction(
	messages: readonly AgentMessage[],
	packet: { customType: string; content: Array<{ type: "text"; text: string }> },
): { messages: AgentMessage[] } | undefined {
	if (messages.some((message) => messageHasMemoryPacket(message))) return undefined;
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
export function registerPairParentMemoryPacket(pi: ExtensionAPI, primarySessionManager: PrimarySessionManager): void {
	pi.on("context", (event) => {
		const primaryEntries = primarySessionManager.getBranch?.() ?? primarySessionManager.getEntries?.() ?? [];
		const packet = buildParentMemoryPacket(primaryEntries);
		if (!packet) return undefined;
		return insertParentMemoryAfterCompaction(event.messages ?? [], packet);
	});
}
