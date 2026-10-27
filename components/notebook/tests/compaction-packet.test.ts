import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";

import { fauxSession } from "../../../tests/helpers/faux-session.js";
import {
	buildNotebookPacket,
	NOTEBOOK_PACKET_CUSTOM_TYPE,
	NOTEBOOK_PACKET_HEADER,
	registerNotebookCompactionPacket,
} from "../src/hooks/compaction-packet.js";
import { registerMainNotebookTool } from "../src/notebook-maintenance.js";
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
	it("keeps one persisted learning packet after each native Pi compaction", async () => {
		let summaryReply = "";
		let recorded = false;
		const { session, requests, dispose } = await fauxSession(
			[
				(pi) => {
					registerMainNotebookTool(pi, new Runtime());
					registerNotebookCompactionPacket(pi);
				},
			],
			() => {
				if (!recorded) {
					recorded = true;
					return fauxAssistantMessage(
						fauxToolCall("update_notebook", { reflections: [{ content: reflection.content }] }, { id: "note-1" }),
						{ stopReason: "toolUse" },
					);
				}
				return fauxAssistantMessage(summaryReply || "Implementation complete.");
			},
			["update_notebook"],
		);
		try {
			session.settingsManager.applyOverrides({ compaction: { keepRecentTokens: 1 } });
			await session.prompt("Preserve the public API.");
			const noteResult = session.messages.find((message) => message.role === "toolResult");
			expect(noteResult).toMatchObject({ toolName: "update_notebook", isError: false });

			for (const [index, summary] of ["Native summary one.", "Native summary two."].entries()) {
				summaryReply = summary;
				const requestStart = requests.length;
				const result = await session.compact("Keep the public API constraint.");
				summaryReply = "";
				expect(result.summary).toContain(summary);
				if (index === 1) {
					expect(JSON.stringify(requests.slice(requestStart))).toContain("Native summary one.");
				}
				const history = session.messages;
				const summaryIndex = history.findIndex((message) => message.role === "compactionSummary");
				const packetIndex = history.findIndex(
					(message) => message.role === "custom" && message.customType === NOTEBOOK_PACKET_CUSTOM_TYPE,
				);
				expect(summaryIndex).toBeGreaterThanOrEqual(0);
				expect(packetIndex).toBeGreaterThan(summaryIndex);
				expect(JSON.stringify(history[packetIndex])).toContain(reflection.content);
				const packets = session.sessionManager
					.getBranch()
					.filter((entry) => entry.type === "custom_message" && entry.customType === NOTEBOOK_PACKET_CUSTOM_TYPE);
				expect(packets).toHaveLength(index + 1);
				await session.prompt("Continue without changing the public API.");
				expect(JSON.stringify(requests.at(-1)?.messages)).toContain(summary);
				expect(JSON.stringify(requests.at(-1)?.messages)).toContain(reflection.content);
			}
		} finally {
			dispose();
		}
	});

	it("builds a packet of current learnings and omits observations", () => {
		const packet = buildNotebookPacket(entries);
		expect(packet?.customType).toBe(NOTEBOOK_PACKET_CUSTOM_TYPE);
		expect(packet?.content[0]?.text).toContain(NOTEBOOK_PACKET_HEADER);
		expect(packet?.content[0]?.text).toContain("[abc123abc123]");
		expect(packet?.content[0]?.text).toContain("## Learnings");
		expect(packet?.content[0]?.text).not.toContain("## Observations");
	});

	it("keeps learnings after compaction removes the covered source", () => {
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

	it("persists the current packet as a hidden steer after compaction and skips an empty notebook", () => {
		const { pi, handlers, messages } = captureExtension();
		registerNotebookCompactionPacket(pi);

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
