import { describe, expect, it } from "vitest";

import installXaiHostedTools, { applyXaiHostedTools } from "../src/index.js";

const xaiResponses = { provider: "xai", api: "openai-responses" };

describe("applyXaiHostedTools", () => {
	it("appends web_search and x_search to xAI Responses payloads", () => {
		const existing = { type: "function", name: "bash" };
		const payload = { model: "grok-4.6", tools: [existing] };

		expect(applyXaiHostedTools(payload, xaiResponses)).toEqual({
			model: "grok-4.6",
			tools: [existing, { type: "web_search" }, { type: "x_search" }],
		});
		expect(payload.tools).toEqual([existing]);
	});

	it("creates a tools array when the payload has none", () => {
		expect(applyXaiHostedTools({ model: "grok-4.6" }, xaiResponses)).toEqual({
			model: "grok-4.6",
			tools: [{ type: "web_search" }, { type: "x_search" }],
		});
	});

	it("adds only the missing hosted tool and leaves an existing one untouched", () => {
		expect(
			applyXaiHostedTools(
				{
					model: "grok-4.6",
					tools: [{ type: "web_search", enable_image_search: true }],
				},
				xaiResponses,
			),
		).toEqual({
			model: "grok-4.6",
			tools: [{ type: "web_search", enable_image_search: true }, { type: "x_search" }],
		});
		expect(
			applyXaiHostedTools(
				{
					model: "grok-4.6",
					tools: [{ type: "x_search", allowed_x_handles: ["xai"] }],
				},
				xaiResponses,
			),
		).toEqual({
			model: "grok-4.6",
			tools: [{ type: "x_search", allowed_x_handles: ["xai"] }, { type: "web_search" }],
		});
	});

	it("leaves both hosted tools untouched when they are already present", () => {
		const payload = {
			model: "grok-4.6",
			tools: [{ type: "web_search" }, { type: "x_search" }],
		};
		expect(applyXaiHostedTools(payload, xaiResponses)).toBeUndefined();
	});

	it("does not rewrite completions-routed xAI or other Responses providers", () => {
		const payload = { model: "grok-4.6" };
		expect(applyXaiHostedTools(payload, { provider: "xai", api: "openai-completions" })).toBeUndefined();
		expect(applyXaiHostedTools(payload, { provider: "openai", api: "openai-responses" })).toBeUndefined();
		expect(applyXaiHostedTools(payload, undefined)).toBeUndefined();
	});

	it("does not replace a non-object payload or a non-array tools field", () => {
		expect(applyXaiHostedTools(null, xaiResponses)).toBeUndefined();
		expect(applyXaiHostedTools("payload", xaiResponses)).toBeUndefined();
		expect(applyXaiHostedTools({ tools: { type: "web_search" } }, xaiResponses)).toBeUndefined();
	});
});

describe("installXaiHostedTools", () => {
	it("registers a before_provider_request hook that injects hosted tools", () => {
		const handlers = new Map<string, (event: unknown, ctx: unknown) => unknown>();
		installXaiHostedTools({
			on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => {
				handlers.set(event, handler);
			},
		} as never);

		const handler = handlers.get("before_provider_request");
		expect(handler?.({ payload: { model: "grok-4.6" } }, { model: xaiResponses })).toEqual({
			model: "grok-4.6",
			tools: [{ type: "web_search" }, { type: "x_search" }],
		});
	});
});
