import type { Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import { afterEach, describe, expect, it, vi } from "vitest";

import { convertMessagesForResponsesCompaction } from "../src/convert.js";
import { compactWithResponses } from "../src/responses.js";
import { serverCompactionMethod } from "../src/target.js";
import type { ResponsesCompactionItem } from "../src/types.js";

const targetModel: Model<"openai-responses"> = {
	id: "target-model",
	name: "Target model",
	api: "openai-responses",
	provider: "xai",
	baseUrl: "https://xai.invalid/v1",
	reasoning: true,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 10_000,
};

afterEach(() => vi.restoreAllMocks());

describe("server compaction targets and conversion", () => {
	it.each([
		{ mismatch: "provider", identity: { provider: "openai" }, keepReasoning: false },
		{ mismatch: "API", identity: { api: "openai-completions" }, keepReasoning: false },
		{ mismatch: "model", identity: { model: "earlier-model" }, keepReasoning: false },
		{ mismatch: "none", identity: {}, keepReasoning: true },
	])(
		"endpoint replay with $mismatch mismatch retains text and only matching signed reasoning",
		async ({ identity, keepReasoning }) => {
			const reasoning = { type: "reasoning", id: "rs_signed", summary: [], encrypted_content: "signed_reasoning" };
			const message = {
				...fauxAssistantMessage("Visible answer"),
				provider: targetModel.provider,
				api: targetModel.api,
				model: targetModel.id,
				...identity,
				content: [
					{ type: "thinking" as const, thinking: "", thinkingSignature: JSON.stringify(reasoning) },
					{ type: "text" as const, text: "Visible answer" },
				],
			};
			const previous = { type: "compaction", id: "cmp_previous", encrypted_content: "previous_blob" };
			const fetch = vi
				.spyOn(globalThis, "fetch")
				.mockResolvedValue(new Response(JSON.stringify({ output: [previous] }), { status: 200 }));
			expect(
				await compactWithResponses({
					model: targetModel,
					auth: { apiKey: "test-only" },
					messages: [message],
					previousItems: [previous],
				}),
			).toEqual([previous]);
			expect(fetch).toHaveBeenCalledTimes(1);
			const [url, request] = fetch.mock.calls[0]!;
			expect(url).toBe("https://xai.invalid/v1/responses/compact");
			const payload = JSON.parse(String(request!.body));
			expect(payload.model).toBe(targetModel.id);
			expect(payload.input).toEqual([
				previous,
				...(keepReasoning ? [reasoning] : []),
				{
					type: "message",
					role: "assistant",
					content: [{ type: "output_text", text: "Visible answer", annotations: [] }],
					status: "completed",
				},
			]);
		},
	);
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
		const converted = convertMessagesForResponsesCompaction(
			[
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
			],
			targetModel,
		);

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
			targetModel,
			[previousItem],
		);

		expect(converted[0]).toEqual(previousItem);
		expect(converted[1]).toEqual({
			role: "user",
			content: [{ type: "input_text", text: "Second turn question" }],
		});
	});
});
