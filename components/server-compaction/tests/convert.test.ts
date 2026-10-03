import { describe, expect, it } from "vitest";

import { convertMessagesForResponsesCompaction } from "../src/convert.js";
import { serverCompactionMethod } from "../src/target.js";
import type { ResponsesCompactionItem } from "../src/types.js";

describe("server compaction targets and conversion", () => {
	it("compacts OpenAI and Codex sign-in with the trigger, xAI with its endpoint, and Anthropic natively", () => {
		expect(serverCompactionMethod({ provider: "openai", api: "openai-responses" })).toBe("trigger");
		expect(serverCompactionMethod({ provider: "openai-codex", api: "openai-codex-responses" })).toBe("trigger");
		expect(serverCompactionMethod({ provider: "xai", api: "openai-responses" })).toBe("endpoint");
		expect(serverCompactionMethod({ provider: "anthropic", api: "anthropic-messages" })).toBe("anthropic");
		expect(serverCompactionMethod({ provider: "xai", api: "openai-completions" })).toBeUndefined();
		expect(serverCompactionMethod({ provider: "amazon-bedrock", api: "anthropic-messages" })).toBeUndefined();
		expect(serverCompactionMethod({ provider: "amazon-bedrock", api: "openai-responses" })).toBeUndefined();
		expect(serverCompactionMethod(undefined)).toBeUndefined();
	});

	it("keeps user text, assistant text, tool calls, and tool results", () => {
		const converted = convertMessagesForResponsesCompaction([
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
		const previousItem: ResponsesCompactionItem = {
			type: "compaction",
			id: "cmp_123",
			encrypted_content: "enc_blob_123",
		};
		const converted = convertMessagesForResponsesCompaction(
			[
				{
					role: "user",
					content: [{ type: "text", text: "Second turn question" }],
					timestamp: Date.now(),
				},
			],
			[previousItem],
		);

		expect(converted[0]).toEqual(previousItem);
		expect(converted[1]).toEqual({
			role: "user",
			content: [{ type: "input_text", text: "Second turn question" }],
		});
	});
});
