import type { Context, Model } from "@earendil-works/pi-ai";
import { OPENAI_MODELS } from "@earendil-works/pi-ai/providers/openai.models";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import { XAI_MODELS } from "@earendil-works/pi-ai/providers/xai.models";
import { describe, expect, it } from "vitest";

import { injectAnthropicCompaction } from "../src/anthropic.js";
import { injectResponsesCompaction } from "../src/responses.js";
import type { AnthropicCompactionBlock, ResponsesCompactionItem, ServerCompaction } from "../src/types.js";

const item: ResponsesCompactionItem = { type: "compaction", id: "cmp_abc", encrypted_content: "enc_xyz" };
const responses = (replacesSummary?: boolean): ServerCompaction => ({
	api: "openai-responses",
	provider: "xai",
	items: [item],
	...(replacesSummary ? { replacesSummary } : {}),
});
const block: AnthropicCompactionBlock = { type: "compaction", content: "SUMMARY TEXT", signature: "sig_1" };
const anthropic = (replacesSummary?: boolean): ServerCompaction => ({
	api: "anthropic-messages",
	provider: "anthropic",
	block,
	...(replacesSummary ? { replacesSummary } : {}),
});
const summaryMessage = (text: string) => ({
	role: "user",
	content: [{ type: "input_text", text: `The conversation history before this point was compacted:\n${text}` }],
});

/** Pi's own request for a session whose transcript declares one tool, as the provider would receive it. */
async function piRequest(model: Model<any>): Promise<Record<string, unknown>> {
	const { stream } = await import(`@earendil-works/pi-ai/api/${model.api}`);
	const context = {
		messages: [
			{
				role: "system",
				content: "You are helpful.",
				toolsAdded: [{ name: "bash", description: "Run a command", parameters: { type: "object", properties: {} } }],
				timestamp: 0,
			},
			{ role: "user", content: "Run it", timestamp: 1 },
		],
	} as unknown as Context;
	// The Codex adapter reads the ChatGPT account from the token before it builds the request.
	const claims = btoa(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "account" } }));
	let payload: Record<string, unknown> | undefined;
	const events = stream(model, context, {
		apiKey: `header.${claims}.signature`,
		onPayload: (built: Record<string, unknown>) => {
			payload = built;
			throw new Error("request captured");
		},
	});
	for await (const _event of events);
	if (!payload) throw new Error(`no request was built for ${model.provider}/${model.id}`);
	return payload;
}

describe("Responses replay", () => {
	it.each([
		["openai", OPENAI_MODELS["gpt-6.1-sol"]],
		["openai-codex", OPENAI_CODEX_MODELS["gpt-6.1-sol"]],
		["xai", XAI_MODELS["grok-4.5"]],
	])(
		"puts the items ahead of everything in a real %s request, so its instructions and tools stay",
		async (_provider, model) => {
			const request = await piRequest(model as Model<any>);
			const result = injectResponsesCompaction(request, responses() as never, undefined) as { input: unknown[] };
			expect(result.input).toEqual([item, ...(request.input as unknown[])]);
			expect(JSON.stringify([request.tools, request.input])).toContain('"bash"');
		},
	);

	it("leaves out the text summary only when it copies the server result", () => {
		const payload = { input: [summaryMessage("FALLBACK"), { role: "user", content: "Next" }] };
		const replaced = injectResponsesCompaction(payload, responses(true) as never, "FALLBACK") as { input: unknown[] };
		expect(replaced.input).toEqual([item, { role: "user", content: "Next" }]);

		const kept = injectResponsesCompaction(payload, responses() as never, "FALLBACK") as { input: unknown[] };
		expect(kept.input).toEqual([item, summaryMessage("FALLBACK"), { role: "user", content: "Next" }]);
	});

	it("does not inject twice", () => {
		expect(injectResponsesCompaction({ input: [item] }, responses() as never, undefined)).toBeUndefined();
	});
});

describe("Anthropic replay", () => {
	it("sends the signed block first with the compaction beta and drops its text copy", () => {
		const result = injectAnthropicCompaction(
			{
				betas: ["oauth-2025-04-20"],
				messages: [
					{ role: "user", content: [{ type: "text", text: "Summary:\nSUMMARY TEXT" }] },
					{ role: "user", content: "Next" },
				],
			},
			anthropic(true) as never,
			"SUMMARY TEXT",
		) as { betas: string[]; messages: unknown[] };
		expect(result.betas).toEqual(["oauth-2025-04-20", "compact-2026-09-04"]);
		expect(result.messages).toEqual([
			{ role: "assistant", content: [block] },
			{ role: "user", content: "Next" },
		]);
	});

	it("keeps a summary that is not the block's copy, such as the pair's reseed", () => {
		const result = injectAnthropicCompaction(
			{ messages: [{ role: "user", content: "RESEED" }] },
			anthropic() as never,
			"RESEED",
		) as { messages: unknown[] };
		expect(result.messages).toEqual([
			{ role: "assistant", content: [block] },
			{ role: "user", content: "RESEED" },
		]);
	});

	it("does not inject twice", () => {
		expect(
			injectAnthropicCompaction(
				{ messages: [{ role: "assistant", content: [block] }] },
				anthropic() as never,
				undefined,
			),
		).toBeUndefined();
	});
});
