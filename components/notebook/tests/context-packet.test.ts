import { describe, expect, it } from "vitest";

import {
	buildNotebookContextPacket,
	messageHasNotebookPacket,
	NOTEBOOK_PACKET_CUSTOM_TYPE,
	NOTEBOOK_PACKET_HEADER,
	registerNotebookContextPacket,
} from "../src/hooks/context-packet.js";
import { Runtime } from "../src/runtime.js";
import type { Entry, Reflection } from "../src/session-ledger/types.js";

const reflection: Reflection = {
	id: "abc123abc123",
	content: "Compaction must stay deterministic.",
	supportingObservationIds: [],
	sourceEntryIds: ["m1"],
	tokenCount: 8,
};

function message(id: string, role: string, content: unknown): Entry {
	return { id, type: "message", message: { role, content } };
}

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
		summary: "Earlier work",
	},
	message("m3", "user", "Continue"),
];

describe("pair programmer notebook context packet", () => {
	it("shares conclusions before the first compaction", () => {
		expect(buildNotebookContextPacket(entries.slice(0, 3))?.content[0].text).toContain(reflection.content);
	});

	it("builds a packet of current working conclusions and omits observations", () => {
		const packet = buildNotebookContextPacket(entries);
		expect(packet?.customType).toBe(NOTEBOOK_PACKET_CUSTOM_TYPE);
		expect(packet?.content[0]?.text).toContain(NOTEBOOK_PACKET_HEADER);
		expect(packet?.content[0]?.text).toContain("[abc123abc123]");
		expect(packet?.content[0]?.text).toContain("Working conclusions");
		expect(packet?.content[0]?.text).not.toContain("## Observations");
	});

	it("keeps working conclusions after compaction removes the covered source", () => {
		const compacted: Entry[] = [
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
				summary: "Earlier work",
			},
			message("m3", "user", "Continue"),
		];
		const packet = buildNotebookContextPacket(compacted);
		expect(packet?.content[0]?.text).toContain("[abc123abc123]");
	});

	it("projects the live tip so later retirements appear before the next compaction", () => {
		const withRetirement: Entry[] = [
			...entries,
			{
				id: "retire-1",
				type: "custom",
				customType: "notebook.reflections.retired",
				data: { reflectionIds: ["abc123abc123"], coversUpToId: "m3" },
			},
		];
		expect(buildNotebookContextPacket(withRetirement)).toBeUndefined();
	});

	it("appends the packet to the conversation tail and is idempotent", () => {
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const runtime = new Runtime();
		runtime.configLoaded = true;
		registerNotebookContextPacket(
			{
				on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
					handlers.set(name, handler);
				},
			} as never,
			runtime,
		);

		const existing = [{ role: "user", content: [{ type: "text", text: "Continue" }] }];
		const ctx = { cwd: "/tmp", sessionManager: { getBranch: () => entries } };
		const first = handlers.get("context")!({ messages: existing }, ctx) as { messages: unknown[] };
		expect(first.messages).toHaveLength(2);
		expect(first.messages.at(-1)).toMatchObject({
			role: "custom",
			customType: NOTEBOOK_PACKET_CUSTOM_TYPE,
		});

		const second = handlers.get("context")!({ messages: first.messages }, ctx) as { messages: unknown[] };
		expect(second.messages).toHaveLength(2);
		const cleared = handlers.get("context")!(
			{ messages: first.messages },
			{ ...ctx, sessionManager: { getBranch: () => [] } },
		) as { messages: unknown[] };
		expect(cleared.messages).toEqual(existing);
		expect(messageHasNotebookPacket({ role: "user", content: NOTEBOOK_PACKET_HEADER })).toBe(false);
		expect(messageHasNotebookPacket(first.messages.at(-1) as { customType?: string })).toBe(true);
	});
});
