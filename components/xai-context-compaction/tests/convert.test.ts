import { describe, expect, it } from "vitest";

import { convertMessagesForXaiCompaction, isXaiResponsesModel } from "../src/convert.js";
import type { XaiCompactionItem } from "../src/types.js";

describe("xAI context compaction conversion", () => {
	it("detects xAI Responses models accurately", () => {
		expect(isXaiResponsesModel({ provider: "xai", api: "openai-responses" })).toBe(true);
		expect(isXaiResponsesModel({ provider: "xai", api: "openai-completions" })).toBe(false);
		expect(isXaiResponsesModel({ provider: "openai", api: "openai-responses" })).toBe(false);
		expect(isXaiResponsesModel(undefined)).toBe(false);
	});

	it("keeps user text, assistant text, tool calls, and tool results", () => {
		const converted = convertMessagesForXaiCompaction([
			{
				role: "user",
				content: [{ type: "text", text: "Read the file" }],
				timestamp: Date.now(),
			},
			{
				role: "assistant",
				content: [
					{ type: "text", text: "Checking" },
					{ type: "toolCall", id: "call1|fc_1", name: "read", arguments: { path: "README.md" } },
				],
				timestamp: Date.now(),
			} as never,
			{
				role: "toolResult",
				toolCallId: "call1|fc_1",
				toolName: "read",
				content: [{ type: "text", text: "README contents" }],
				isError: false,
				timestamp: Date.now(),
			} as never,
		]);

		expect(converted).toEqual([
			{ role: "user", content: [{ type: "input_text", text: "Read the file" }] },
			{
				type: "message",
				role: "assistant",
				content: [{ type: "output_text", text: "Checking", annotations: [] }],
				status: "completed",
			},
			{
				type: "function_call",
				id: "fc_1",
				call_id: "call1",
				name: "read",
				arguments: JSON.stringify({ path: "README.md" }),
			},
			{
				type: "function_call_output",
				call_id: "call1",
				output: "README contents",
			},
		]);
	});

	it("prepends the previous compaction item when chaining", () => {
		const previousItem: XaiCompactionItem = {
			type: "compaction",
			id: "cmp_123",
			encrypted_content: "enc_blob_123",
		};
		const converted = convertMessagesForXaiCompaction(
			[
				{
					role: "user",
					content: [{ type: "text", text: "Second turn question" }],
					timestamp: Date.now(),
				},
			],
			previousItem,
		);

		expect(converted[0]).toEqual(previousItem);
		expect(converted[1]).toEqual({
			role: "user",
			content: [{ type: "input_text", text: "Second turn question" }],
		});
	});
});
