import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import {
	compactOnServer,
	fallbackSummary,
	findLatestServerCompaction,
	registerServerCompactionHooks,
	registerServerCompactionReplayHooks,
} from "../src/hooks.js";
import type { ResponsesCompactionItem } from "../src/types.js";

const xaiResponsesModel = {
	id: "grok-4.6",
	name: "Grok 4.6",
	provider: "xai",
	api: "openai-responses",
	baseUrl: "https://api.x.ai/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 8000,
} as Model<any>;

const xaiServerCompaction = {
	api: "openai-responses",
	provider: "xai",
	items: [{ type: "compaction", id: "cmp_abc", encrypted_content: "enc_xyz" }],
};

function assistantMessage(text: string): AgentMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp: 0,
		api: "openai-responses",
		provider: "xai",
		model: "grok-4.6",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
	};
}

function captureHandlers() {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	registerServerCompactionHooks({
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			handlers.set(event, handler);
		},
		getActiveTools: () => [],
		getAllTools: () => [],
	} as never);
	return handlers;
}

describe("server compaction hooks", () => {
	it("uses only the newest compaction entry", () => {
		const item1: ResponsesCompactionItem = { type: "compaction", id: "cmp_1", encrypted_content: "enc_1" };
		const item2: ResponsesCompactionItem = { type: "compaction", id: "cmp_2", encrypted_content: "enc_2" };
		const server = (item: ResponsesCompactionItem) => ({ api: "openai-responses", provider: "xai", items: [item] });
		expect(
			findLatestServerCompaction([
				{ type: "compaction", details: { serverCompaction: server(item1) } },
				{ type: "compaction", summary: "S2", details: { serverCompaction: server(item2) } },
				{ type: "message" },
			]),
		).toEqual({ compaction: server(item2), summary: "S2" });
		expect(
			findLatestServerCompaction([
				{ type: "compaction", details: { serverCompaction: server(item1) } },
				{ type: "compaction", summary: "Pi summary" },
			]),
		).toBeUndefined();
	});

	it("returns a compaction result with the opaque item and a text summary", async () => {
		const handlers = captureHandlers();
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue({
				ok: true,
				json: async () => ({
					output: [{ type: "compaction", id: "cmp_live", encrypted_content: "enc_live_data" }],
				}),
			}),
		);

		const result = (await handlers.get("session_before_compact")!(
			{
				preparation: {
					messagesToSummarize: [{ role: "user", content: [{ type: "text", text: "query" }], timestamp: Date.now() }],
					turnPrefixMessages: [],
					tokensBefore: 5000,
					firstKeptEntryId: "entry-kept",
					previousSummary: "PI DEFAULT HISTORY: keep this decision",
				},
				branchEntries: [],
			},
			{
				model: xaiResponsesModel,
				modelRegistry: {
					getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-xai-key" }),
				},
				ui: { notify: vi.fn() },
			},
		)) as { compaction: { summary: string } } | undefined;

		expect(result).toMatchObject({
			compaction: {
				firstKeptEntryId: "entry-kept",
				details: {
					serverCompaction: {
						api: "openai-responses",
						provider: "xai",
						items: [{ type: "compaction", id: "cmp_live", encrypted_content: "enc_live_data" }],
						replacesSummary: true,
					},
				},
			},
		});
		expect(result?.compaction.summary).toContain("[Server-side compaction cmp_live]");
		expect(result?.compaction.summary).toContain("query");
		expect(result?.compaction.summary).toContain("PI DEFAULT HISTORY: keep this decision");
	});

	it("keeps a bounded projection of early and recent compacted history in its fallback", () => {
		const summary = fallbackSummary("cmp_fallback", [
			{ role: "user", content: [{ type: "text", text: `EARLY REQUIREMENT ${"a".repeat(8_000)}` }], timestamp: 1 },
			assistantMessage(`RECENT DECISION ${"b".repeat(8_000)}`),
		]);

		expect(summary).toContain("EARLY REQUIREMENT");
		expect(summary).toContain("RECENT DECISION");
		expect(summary).toContain("[middle omitted]");
		expect(summary.length).toBeLessThanOrEqual(12_000);
	});

	it("carries a prior fallback into a later compaction fallback", () => {
		const prior = fallbackSummary("cmp_a", [
			{ role: "user", content: [{ type: "text", text: "A: retain the original requirement" }], timestamp: 1 },
		]);
		const next = fallbackSummary("cmp_b", [assistantMessage("B: continue with the latest decision")], prior);

		expect(next).toContain("A: retain the original requirement");
		expect(next).toContain("B: continue with the latest decision");
		expect(next.length).toBeLessThanOrEqual(12_000);
	});

	it("returns undefined when the registry cannot resolve auth", async () => {
		const result = await compactOnServer(
			{
				preparation: {
					messagesToSummarize: [],
					turnPrefixMessages: [],
					tokensBefore: 1000,
					firstKeptEntryId: "entry-kept",
				},
				branchEntries: [],
			} as never,
			{ model: xaiResponsesModel } as never,
			[],
		);
		expect(result).toBeUndefined();
	});

	it("replay hooks do not register a compact handler", () => {
		const handlers = new Map<string, unknown>();
		registerServerCompactionReplayHooks({
			on(event: string, handler: unknown) {
				handlers.set(event, handler);
			},
		} as never);
		expect(handlers.has("session_before_compact")).toBe(false);
		expect(handlers.has("before_provider_request")).toBe(true);
		expect(handlers.has("after_provider_response")).toBe(true);
	});

	it("returns undefined for models without server-side compaction so Pi's summarizer runs", async () => {
		const handlers = captureHandlers();
		const result = await handlers.get("session_before_compact")!(
			{
				preparation: {
					messagesToSummarize: [],
					turnPrefixMessages: [],
					tokensBefore: 1000,
					firstKeptEntryId: "entry-kept",
				},
				branchEntries: [],
			},
			{ model: { ...xaiResponsesModel, provider: "amazon-bedrock" } },
		);
		expect(result).toBeUndefined();
	});

	it("does not disable injection for a 4xx on an opaque item it did not inject", async () => {
		const handlers = captureHandlers();
		const notify = vi.fn();
		const ctx = {
			model: xaiResponsesModel,
			ui: { notify },
			sessionManager: {
				getBranch: () => [
					{
						type: "compaction",
						details: { serverCompaction: xaiServerCompaction },
					},
				],
			},
		};

		handlers.get("before_provider_request")!(
			{ payload: { model: "grok-4.6", input: [{ type: "compaction", id: "cmp_abc", encrypted_content: "enc_xyz" }] } },
			ctx,
		);
		await handlers.get("after_provider_response")!({ status: 400, headers: {} }, ctx);
		expect(notify).not.toHaveBeenCalled();

		const retry = handlers.get("before_provider_request")!(
			{ payload: { model: "grok-4.6", input: [{ role: "user", content: "retry" }] } },
			ctx,
		) as { input: Array<{ type?: string }> };
		expect(retry.input[0]?.type).toBe("compaction");
	});

	it("does not attribute an overlapping request's 4xx to opaque injection", async () => {
		const handlers = captureHandlers();
		const notify = vi.fn();
		const ctx = {
			model: xaiResponsesModel,
			ui: { notify },
			sessionManager: {
				getBranch: () => [
					{
						type: "compaction",
						details: { serverCompaction: xaiServerCompaction },
					},
				],
			},
		};

		handlers.get("before_provider_request")!({ payload: { input: [{ role: "user", content: "opaque" }] } }, ctx);
		handlers.get("before_provider_request")!(
			{ payload: { input: [{ role: "user", content: "unrelated" }] } },
			{ ...ctx, model: { ...xaiResponsesModel, provider: "openai" } },
		);
		await handlers.get("after_provider_response")!({ status: 200, headers: {} }, ctx);
		await handlers.get("after_provider_response")!({ status: 400, headers: {} }, ctx);
		expect(notify).not.toHaveBeenCalled();

		const retry = handlers.get("before_provider_request")!(
			{ payload: { input: [{ role: "user", content: "retry" }] } },
			ctx,
		) as { input: Array<{ type?: string }> };
		expect(retry.input[0]?.type).toBe("compaction");
		await handlers.get("after_provider_response")!({ status: 200, headers: {} }, ctx);

		handlers.get("before_provider_request")!({ payload: { input: [{ role: "user", content: "opaque again" }] } }, ctx);
		handlers.get("before_provider_request")!(
			{ payload: { input: [{ role: "user", content: "unrelated again" }] } },
			{ ...ctx, model: { ...xaiResponsesModel, provider: "openai" } },
		);
		await handlers.get("after_provider_response")!({ status: 400, headers: {} }, ctx);
		await handlers.get("after_provider_response")!({ status: 200, headers: {} }, ctx);
		expect(notify).not.toHaveBeenCalled();
	});

	it("clears abandoned request attribution at the agent boundary", async () => {
		const handlers = captureHandlers();
		const notify = vi.fn();
		const ctx = {
			model: xaiResponsesModel,
			ui: { notify },
			sessionManager: {
				getBranch: () => [
					{
						type: "compaction",
						details: { serverCompaction: xaiServerCompaction },
					},
				],
			},
		};

		handlers.get("before_provider_request")!({ payload: { input: [{ role: "user", content: "aborted" }] } }, ctx);
		handlers.get("agent_end")!({}, ctx);
		await handlers.get("after_provider_response")!({ status: 400, headers: {} }, ctx);
		expect(notify).not.toHaveBeenCalled();

		const retry = handlers.get("before_provider_request")!(
			{ payload: { input: [{ role: "user", content: "retry" }] } },
			ctx,
		) as { input: Array<{ type?: string }> };
		expect(retry.input[0]?.type).toBe("compaction");
	});

	it("disables further injection after a 4xx on a request that carried a compaction item", async () => {
		const handlers = captureHandlers();
		const notify = vi.fn();
		const ctx = {
			model: xaiResponsesModel,
			ui: { notify },
			sessionManager: {
				getBranch: () => [
					{
						type: "compaction",
						details: { serverCompaction: xaiServerCompaction },
					},
				],
			},
		};

		const injected = handlers.get("before_provider_request")!(
			{ payload: { model: "grok-4.6", input: [{ role: "user", content: "hi" }] } },
			ctx,
		) as { input: Array<{ type?: string }> };
		expect(injected.input[0]?.type).toBe("compaction");

		await handlers.get("after_provider_response")!({ status: 400, headers: {} }, ctx);
		expect(notify).toHaveBeenCalled();

		const afterDisable = handlers.get("before_provider_request")!(
			{ payload: { model: "grok-4.6", input: [{ role: "user", content: "hi again" }] } },
			ctx,
		);
		expect(afterDisable).toBeUndefined();
	});
});
