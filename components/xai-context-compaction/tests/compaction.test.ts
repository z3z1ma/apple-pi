import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";

import {
	compactWithXai,
	findLatestXaiCompaction,
	registerXaiCompactionHooks,
	registerXaiCompactionReplayHooks,
} from "../src/hooks.js";
import type { XaiCompactionItem } from "../src/types.js";

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
} as Model;

function captureHandlers() {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
	registerXaiCompactionHooks({
		on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
			handlers.set(event, handler);
		},
	} as never);
	return handlers;
}

describe("registerXaiCompactionHooks", () => {
	it("finds the newest persisted xAI compaction item", () => {
		const item1: XaiCompactionItem = { type: "compaction", id: "cmp_1", encrypted_content: "enc_1" };
		const item2: XaiCompactionItem = { type: "compaction", id: "cmp_2", encrypted_content: "enc_2" };
		expect(
			findLatestXaiCompaction([
				{ type: "compaction", details: { xaiCompaction: item1 } },
				{ type: "message" },
				{ type: "compaction", details: { xaiCompaction: item2 } },
				{ type: "message" },
			]),
		).toEqual(item2);
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

		const result = await handlers.get("session_before_compact")!(
			{
				preparation: {
					messagesToSummarize: [{ role: "user", content: [{ type: "text", text: "query" }], timestamp: Date.now() }],
					turnPrefixMessages: [],
					tokensBefore: 5000,
					firstKeptEntryId: "entry-kept",
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
		);

		expect(result).toMatchObject({
			compaction: {
				firstKeptEntryId: "entry-kept",
				details: {
					xaiCompaction: {
						type: "compaction",
						id: "cmp_live",
						encrypted_content: "enc_live_data",
					},
				},
			},
		});
		expect(result?.compaction.summary).toContain("[xAI Server-Side Compaction cmp_live]");
		expect(result?.compaction.summary).toContain("query");
	});

	it("returns undefined when the registry cannot resolve auth", async () => {
		const result = await compactWithXai(
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
		);
		expect(result).toBeUndefined();
	});

	it("replay hooks do not register a compact handler", () => {
		const handlers = new Map<string, unknown>();
		registerXaiCompactionReplayHooks({
			on(event: string, handler: unknown) {
				handlers.set(event, handler);
			},
		} as never);
		expect(handlers.has("session_before_compact")).toBe(false);
		expect(handlers.has("before_provider_request")).toBe(true);
		expect(handlers.has("after_provider_response")).toBe(true);
	});

	it("returns undefined for non-xAI models so Pi default compaction can run", async () => {
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
			{ model: { ...xaiResponsesModel, provider: "openai" } },
		);
		expect(result).toBeUndefined();
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
						details: {
							xaiCompaction: { type: "compaction", id: "cmp_abc", encrypted_content: "enc_xyz" },
						},
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
