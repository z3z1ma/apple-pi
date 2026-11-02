import type { Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { renderMessage } from "../src/render-entries.js";
import { searchEntries } from "../src/search-entries.js";

const search = (messages: Message[], query: string) =>
	searchEntries(
		messages.map((msg, index) => renderMessage(msg, index)),
		messages,
		query,
	);

describe("answer-bearing evidence windows", () => {
	it("prefers a local passage covering more meaningful query terms over the first weak match", () => {
		const message = {
			role: "assistant",
			content: [
				{
					type: "text",
					text: [
						"alpha mentioned in passing",
						...Array(12).fill("filler"),
						"alpha beta gamma: the actual decision",
						"Keep the owner stable.",
					].join("\n"),
				},
			],
		} as any;
		const hits = search([message], "alpha beta gamma");
		expect(hits[0].snippet).toContain("Keep the owner stable.");
		expect(hits[0].snippet).not.toContain("mentioned in passing");
	});

	it("labels thinking, attempted calls and failed results rather than presenting them as successful facts", () => {
		const messages: Message[] = [
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "hypothesisneedle unproven" },
					{ type: "toolCall", id: "attempt", name: "write", arguments: { path: "a.ts", content: "payloadneedle" } },
				],
			} as any,
			{
				role: "toolResult",
				toolCallId: "attempt",
				toolName: "write",
				isError: true,
				content: [{ type: "text", text: "failuretarget permission denied" }],
			} as any,
		];
		expect(search(messages, "hypothesisneedle")[0].snippet).toContain("[thinking]");
		expect(search(messages, "payloadneedle")[0].snippet).toContain("[attempted write call:attempt]");
		expect(search(messages, "failuretarget")[0].snippet).toContain("[failed write call:attempt]");
	});

	it("keeps repeated recall output behind original evidence in default discovery", () => {
		const messages: Message[] = [
			{
				role: "toolResult",
				toolName: "search_session",
				toolCallId: "recall",
				content: [{ type: "text", text: "needle needle needle" }],
			} as any,
			{ role: "user", content: "needle: the original decision was to retain the owner" } as any,
		];
		expect(search(messages, "needle").map((hit) => hit.index)).toEqual([1, 0]);
	});
});
