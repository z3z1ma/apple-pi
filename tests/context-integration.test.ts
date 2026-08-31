import { describe, expect, it } from "vitest";

import {
	buildNotebookContextPacket,
	NOTEBOOK_PACKET_CUSTOM_TYPE,
	NOTEBOOK_PACKET_HEADER,
} from "../components/notebook/src/hooks/context-packet.js";
import type { Entry, Observation } from "../components/notebook/src/session-ledger/types.js";

function message(id: string, role: string, content: unknown): Entry {
	return { id, type: "message", message: { role, content } };
}

describe("pair programmer notebook after normal compaction", () => {
	it("places the folded packet after a compaction entry for conversation continuity", () => {
		const observation: Observation = {
			id: "abc123abc123",
			content: "The project requires deterministic compaction.",
			timestamp: "2026-08-15T10:00:00.000Z",
			relevance: "high",
			sourceEntryIds: ["m1"],
			tokenCount: 8,
		};
		const entries: Entry[] = [
			message("m1", "user", "Build deterministic context compaction"),
			message("m2", "assistant", [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } }]),
			{
				id: "notebook-1",
				type: "custom",
				customType: "notebook.observations.recorded",
				data: { observations: [observation], coversUpToId: "m2" },
			},
			{
				id: "compact-1",
				type: "compaction",
				firstKeptEntryId: "m3",
				summary: "Conversation compacted.",
			},
			message("m3", "user", "Continue"),
		];

		const packet = buildNotebookContextPacket(entries, 100);
		expect(packet?.customType).toBe(NOTEBOOK_PACKET_CUSTOM_TYPE);
		expect(packet?.content[0]?.text).toContain(NOTEBOOK_PACKET_HEADER);
		expect(packet?.content[0]?.text).toContain("## Observations");
		expect(packet?.content[0]?.text).toContain("[abc123abc123]");
	});
});
