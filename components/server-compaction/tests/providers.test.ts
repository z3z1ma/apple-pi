import { describe, expect, it, vi } from "vitest";

import { compactOnServer } from "../src/hooks.js";

const model = (provider: string, api: string) => ({ id: "m", provider, api, baseUrl: "", maxTokens: 64_000 });
const block = { type: "compaction", content: "CLAUDE SUMMARY", signature: "sig_new" };

function event(previous?: unknown) {
	return {
		preparation: {
			messagesToSummarize: [{ role: "user", content: "older work", timestamp: 1 }],
			turnPrefixMessages: [],
			tokensBefore: 9000,
			firstKeptEntryId: "kept",
			settings: { enabled: true, reserveTokens: 20_000, keepRecentTokens: 2000 },
		},
		branchEntries: previous ? [{ type: "compaction", summary: "old", details: { serverCompaction: previous } }] : [],
		signal: new AbortController().signal,
	} as never;
}

/** Plays the provider: hands the built request to onPayload and streams the given events. */
function registry(events: unknown[], stopReason = "stop") {
	const seen: { payload?: Record<string, unknown>; maxTokens?: number; cancelled?: boolean } = {};
	const complete = vi.fn(async (_model, _context, options) => {
		seen.payload = options.onPayload({
			betas: ["oauth-2025-04-20"],
			input: [{ role: "developer", content: "system" }],
			messages: [{ role: "user", content: "older work" }],
			stop_sequences: ["x"],
		});
		seen.maxTokens = options.maxTokens;
		for (const streamed of events) {
			options.onProviderStreamEvent?.(streamed);
			if (options.signal?.aborted) break;
		}
		seen.cancelled = options.signal?.aborted ?? false;
		return { stopReason, errorMessage: stopReason === "error" ? "Unhandled stop reason: compaction" : undefined };
	});
	return { complete, seen };
}

function ctx(provider: string, api: string, complete: unknown, apiKey = "sk-test") {
	return {
		model: model(provider, api),
		modelRegistry: { complete, getApiKeyAndHeaders: async () => ({ ok: true, apiKey }) },
		getSystemPrompt: () => "system",
		ui: { notify: vi.fn() },
	} as never;
}

describe("Anthropic server-side compaction", () => {
	it("sends a summarize request and keeps the signed block with its readable summary", async () => {
		const { complete, seen } = registry([{ type: "content_block_start", content_block: block }], "error");
		const result = await compactOnServer(event(), ctx("anthropic", "anthropic-messages", complete), []);

		expect(seen.payload).toMatchObject({
			compaction: { type: "summarize" },
			betas: ["oauth-2025-04-20", "compact-2026-09-04"],
		});
		expect(seen.payload).not.toHaveProperty("stop_sequences");
		expect(seen.maxTokens).toBe(16_000);
		expect(result).toEqual({
			serverCompaction: { api: "anthropic-messages", provider: "anthropic", block },
			summary: "CLAUDE SUMMARY",
		});
	});

	it("summarizes the previous block again instead of its text copy", async () => {
		const previous = {
			api: "anthropic-messages",
			provider: "anthropic",
			block: { type: "compaction", content: "OLD", signature: "sig_old" },
		};
		const { complete, seen } = registry([{ type: "content_block_start", content_block: block }]);
		await compactOnServer(event(previous), ctx("anthropic", "anthropic-messages", complete), []);
		expect((seen.payload?.messages as unknown[] | undefined)?.[0]).toEqual({
			role: "assistant",
			content: [previous.block],
		});
	});

	it("falls back to Pi with the provider's reason when no block arrives", async () => {
		const { complete } = registry([], "error");
		const context = ctx("anthropic", "anthropic-messages", complete);
		expect(await compactOnServer(event(), context, [])).toBeUndefined();
		expect((context as { ui: { notify: ReturnType<typeof vi.fn> } }).ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("Unhandled stop reason: compaction"),
			"warning",
		);
	});
});

describe("OpenAI server-side compaction", () => {
	it.each([
		["openai", "openai-responses"],
		["openai-codex", "openai-codex-responses"],
	])("asks %s for one compaction item with a trailing compaction_trigger", async (provider, api) => {
		const item = { type: "compaction", id: "cmp_1", encrypted_content: "enc_1" };
		const { complete, seen } = registry([{ type: "response.output_item.done", item }]);
		const result = await compactOnServer(event(), ctx(provider, api, complete), []);

		expect(seen.payload?.input).toEqual([{ role: "developer", content: "system" }, { type: "compaction_trigger" }]);
		expect(seen.payload).not.toHaveProperty("context_management");
		expect(complete.mock.calls[0]?.[2]).toMatchObject({ transport: "sse" });
		expect(result?.serverCompaction).toEqual({ api, provider, items: [item] });
		expect(result?.summary).toContain("[Server-side compaction cmp_1]");
	});

	it("stops subscription generation at the first complete compaction item", async () => {
		const item = { type: "compaction", id: "cmp_2", encrypted_content: "enc_2" };
		const { complete, seen } = registry([
			{ type: "response.output_item.done", item: { type: "compaction", id: "cmp_1", encrypted_content: "enc_1" } },
			{ type: "response.output_item.done", item: { type: "message" } },
			{ type: "response.output_item.done", item },
		]);
		const result = await compactOnServer(event(), ctx("openai", "openai-responses", complete, "chatgpt-token"), []);

		expect(seen.payload?.context_management).toEqual([{ type: "compaction", compact_threshold: 1000 }]);
		expect(seen.payload?.input).toEqual([{ role: "developer", content: "system" }]);
		expect(result?.serverCompaction).toEqual({
			api: "openai-responses",
			provider: "openai",
			items: [{ type: "compaction", id: "cmp_1", encrypted_content: "enc_1" }],
		});
		expect(seen.cancelled).toBe(true);
	});

	it("keeps a complete checkpoint when its own cancellation rejects the reply", async () => {
		const item = { type: "compaction", id: "cmp_complete", encrypted_content: "enc_complete" };
		let cancelled = false;
		const complete = vi.fn(async (_model, _context, options) => {
			options.onProviderStreamEvent({ type: "response.output_item.done", item });
			cancelled = options.signal?.aborted ?? false;
			throw new DOMException("Reply cancelled", "AbortError");
		});
		const result = await compactOnServer(event(), ctx("openai", "openai-responses", complete, "chatgpt-token"), []);
		expect(cancelled).toBe(true);
		expect(result?.serverCompaction).toMatchObject({ items: [item] });
	});

	it("does not publish a captured checkpoint after caller cancellation", async () => {
		const controller = new AbortController();
		const item = { type: "compaction", id: "cmp_cancelled", encrypted_content: "enc_cancelled" };
		const complete = vi.fn(async (_model, _context, options) => {
			options.onProviderStreamEvent({ type: "response.output_item.done", item });
			controller.abort();
			return { stopReason: "aborted" };
		});
		const context = ctx("openai", "openai-responses", complete, "chatgpt-token");
		expect(await compactOnServer(Object.assign(event(), { signal: controller.signal }), context, [])).toBeUndefined();
		expect((context as { ui: { notify: ReturnType<typeof vi.fn> } }).ui.notify).not.toHaveBeenCalled();
	});

	it("chains the previous items ahead of the developer prompt", async () => {
		const previous = {
			api: "openai-responses",
			provider: "openai",
			items: [{ type: "compaction", id: "cmp_0", encrypted_content: "enc_0" }],
		};
		const { complete, seen } = registry([
			{ type: "response.output_item.done", item: { type: "compaction", id: "cmp_1", encrypted_content: "enc_1" } },
		]);
		await compactOnServer(event(previous), ctx("openai", "openai-responses", complete), []);
		expect(seen.payload?.input).toEqual([
			...previous.items,
			{ role: "developer", content: "system" },
			{ type: "compaction_trigger" },
		]);
	});
});
