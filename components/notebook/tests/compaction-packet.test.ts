import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import {
	buildNotebookPacket,
	NOTEBOOK_PACKET_CUSTOM_TYPE,
	NOTEBOOK_PACKET_HEADER,
	registerNotebookCompactionPacket,
} from "../src/hooks/compaction-packet.js";
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

function captureExtension() {
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => unknown>();
	const messages: Array<{ message: unknown; options: unknown }> = [];
	const pi = {
		on(event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown) {
			handlers.set(event, handler);
		},
		sendMessage(message: unknown, options: unknown) {
			messages.push({ message, options });
		},
	} as unknown as ExtensionAPI;
	return { pi, handlers, messages };
}

function contextFor(branch: Entry[]): ExtensionContext {
	return { sessionManager: { getBranch: () => branch } } as unknown as ExtensionContext;
}

describe("pair programmer notebook compaction packet", () => {
	it("builds a packet of current working conclusions and omits observations", () => {
		const packet = buildNotebookPacket(entries);
		expect(packet?.customType).toBe(NOTEBOOK_PACKET_CUSTOM_TYPE);
		expect(packet?.content[0]?.text).toContain(NOTEBOOK_PACKET_HEADER);
		expect(packet?.content[0]?.text).toContain("[abc123abc123]");
		expect(packet?.content[0]?.text).toContain("Working conclusions");
		expect(packet?.content[0]?.text).not.toContain("## Observations");
	});

	it("keeps working conclusions after compaction removes the covered source", () => {
		const packet = buildNotebookPacket(entries.slice(2));
		expect(packet?.content[0]?.text).toContain("[abc123abc123]");
	});

	it("is empty once every conclusion is retired", () => {
		const withRetirement: Entry[] = [
			...entries,
			{
				id: "retire-1",
				type: "custom",
				customType: "notebook.reflections.retired",
				data: { reflectionIds: ["abc123abc123"], coversUpToId: "m3" },
			},
		];
		expect(buildNotebookPacket(withRetirement)).toBeUndefined();
	});

	it("persists the packet once per compaction and never touches the request context", () => {
		const { pi, handlers, messages } = captureExtension();
		registerNotebookCompactionPacket(pi);

		expect([...handlers.keys()]).toEqual(["session_compact"]);

		handlers.get("session_compact")!({ type: "session_compact" }, contextFor(entries));
		expect(messages).toEqual([
			{
				message: {
					customType: NOTEBOOK_PACKET_CUSTOM_TYPE,
					content: buildNotebookPacket(entries)?.content,
					display: false,
				},
				options: { deliverAs: "steer", triggerTurn: false },
			},
		]);

		handlers.get("session_compact")!({ type: "session_compact" }, contextFor([]));
		expect(messages).toHaveLength(1);
	});
});
