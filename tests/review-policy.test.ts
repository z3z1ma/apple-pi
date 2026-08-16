import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { deriveReviewBudgets, deriveRoleEnvelope } from "../components/review/src/policy.js";
import { createReviewResultTool } from "../components/review/src/roles.js";

const model = { provider: "test", id: "review", contextWindow: 64_000, maxTokens: 8_000 } as Model<any>;

function envelope(prompt: string) {
	const budgets = deriveReviewBudgets("balanced", { selectedItems: 2, diffBytes: 500, binaryWaivers: 0 });
	const tool = createReviewResultTool("reviewer").tool;
	return deriveRoleEnvelope({
		stage: "reviewer",
		mode: "review-fast",
		model,
		profile: "balanced",
		budgets,
		prompt,
		systemPrompt: "Read-only review role.",
		resultTool: tool,
		elapsedSeconds: 0,
		totalTokens: 0,
	});
}

describe("review harness policy", () => {
	it("derives group/concurrency caps from sealed shape under package maxima", () => {
		const small = deriveReviewBudgets("balanced", { selectedItems: 2, diffBytes: 1_000, binaryWaivers: 0 });
		const larger = deriveReviewBudgets("balanced", { selectedItems: 100, diffBytes: 400_000, binaryWaivers: 3 });
		// Change shape permits two independent files; semantic grouping still decides cohesion.
		expect(small.maxGroups).toBe(2);
		expect(small.maxConcurrency).toBe(2);
		expect(larger.maxGroups).toBeGreaterThan(small.maxGroups);
		expect(larger.maxGroups).toBeLessThanOrEqual(24);
		expect(larger.maxConcurrency).toBeLessThanOrEqual(4);
	});

	it("measures packaged instructions and the full typed tool signature", () => {
		const value = envelope("Review a small diff.");
		expect(value.resultToolBytes).toBeGreaterThan(100);
		expect(value.promptBytes).toBeGreaterThan(value.resultToolBytes);
		expect(value.expectedRequests).toBe(3);
		expect(value.maxTokens).toBeGreaterThanOrEqual(value.expectedRequests * (value.estimatedInputTokens + value.reservedOutputTokens));
	});

	it("rejects a broad authority packet before launching a model when it cannot fit context", () => {
		expect(() => envelope("x".repeat(300_000))).toThrow(/context window|prompt is/i);
	});
});
