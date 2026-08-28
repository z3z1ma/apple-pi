import { describe, expect, it } from "vitest";

import {
	buildMemoryContextPacket,
	latestCompactionBoundary,
	MEMORY_PACKET_CUSTOM_TYPE,
	MEMORY_PACKET_HEADER,
	messageHasMemoryPacket,
	registerMemoryContextPacket,
} from "../src/hooks/context-packet.js";
import { Runtime } from "../src/runtime.js";
import type { Entry, Observation } from "../src/session-ledger/types.js";

const observation: Observation = {
	id: "abc123abc123",
	content: "The project requires deterministic compaction.",
	timestamp: "2026-08-15T10:00:00.000Z",
	relevance: "high",
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
		id: "memory-1",
		type: "custom",
		customType: "om.observations.recorded",
		data: { observations: [observation], coversUpToId: "m2" },
	},
	{
		id: "compact-1",
		type: "compaction",
		firstKeptEntryId: "m3",
		summary: "Earlier work",
	},
	message("m3", "user", "Continue"),
];

describe("Pair memory context packet", () => {
	it("uses the latest compaction firstKeptEntryId as the projection boundary", () => {
		expect(latestCompactionBoundary(entries)).toBe("m3");
		expect(latestCompactionBoundary(entries.slice(0, 3))).toBeUndefined();
	});

	it("builds a packet that includes visible observations", () => {
		const packet = buildMemoryContextPacket(entries, 100);
		expect(packet?.customType).toBe(MEMORY_PACKET_CUSTOM_TYPE);
		expect(packet?.content[0]?.text).toContain(MEMORY_PACKET_HEADER);
		expect(packet?.content[0]?.text).toContain("[abc123abc123]");
	});

	it("appends the packet to the conversation tail and is idempotent", () => {
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		const runtime = new Runtime();
		runtime.configLoaded = true;
		registerMemoryContextPacket(
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
			customType: MEMORY_PACKET_CUSTOM_TYPE,
		});

		const second = handlers.get("context")!({ messages: first.messages }, ctx);
		expect(second).toBeUndefined();
		expect(messageHasMemoryPacket(first.messages.at(-1) as { customType?: string })).toBe(true);
	});
});
