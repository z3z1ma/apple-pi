import { describe, expect, it } from "vitest";

import {
	buildNotebookContextPacket,
	NOTEBOOK_PACKET_CUSTOM_TYPE,
	NOTEBOOK_PACKET_HEADER,
} from "../components/notebook/src/hooks/context-packet.js";
import type { Entry, Reflection } from "../components/notebook/src/session-ledger/types.js";

function message(id: string, role: string, content: unknown): Entry {
	return { id, type: "message", message: { role, content } };
}

describe("pair programmer notebook after normal compaction", () => {
	it("places the folded packet after a compaction entry for conversation continuity", () => {
		const reflection: Reflection = {
			id: "abc123abc123",
			content: "Compaction must stay deterministic.",
			supportingObservationIds: [],
			sourceEntryIds: ["m1"],
			tokenCount: 8,
		};
		const entries: Entry[] = [
			message("m1", "user", "Build deterministic context compaction"),
			message("m2", "assistant", [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: "README.md" } }]),
			{
				id: "notebook-1",
				type: "custom",
				customType: "notebook.reflections.recorded",
				data: { reflections: [reflection], coversUpToId: "m2" },
			},
			{
				id: "compact-1",
				type: "compaction",
				firstKeptEntryId: "m3",
				summary: "Conversation compacted.",
			},
			message("m3", "user", "Continue"),
		];

		const packet = buildNotebookContextPacket(entries);
		expect(packet?.customType).toBe(NOTEBOOK_PACKET_CUSTOM_TYPE);
		expect(packet?.content[0]?.text).toContain(NOTEBOOK_PACKET_HEADER);
		expect(packet?.content[0]?.text).toContain("## Working conclusions");
		expect(packet?.content[0]?.text).toContain("[abc123abc123]");
		expect(packet?.content[0]?.text).not.toContain("## Observations");
	});
});
