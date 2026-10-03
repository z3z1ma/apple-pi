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

describe("Responses replay", () => {
	it("puts the items after a leading developer prompt", () => {
		const result = injectResponsesCompaction(
			{
				input: [
					{ role: "developer", content: "You are helpful." },
					{ role: "user", content: "Next" },
				],
			},
			responses() as never,
			undefined,
		) as { input: unknown[] };
		expect(result.input).toEqual([
			{ role: "developer", content: "You are helpful." },
			item,
			{ role: "user", content: "Next" },
		]);
	});

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
