import type { Model } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { deriveReviewBudgets, deriveRoleEnvelope } from "../src/policy.js";
import { createReportTool } from "../src/roles.js";

const model = { provider: "test", id: "review", contextWindow: 64_000, maxTokens: 8_000 } as Model<any>;

function envelope(prompt: string) {
	const budgets = deriveReviewBudgets("balanced", { selectedItems: 2, diffBytes: 500, binaryWaivers: 0 });
	const tool = createReportTool().tool;
	return deriveRoleEnvelope({
		stage: "reviewer",
		mode: "review-routine",
		model,
		profile: "balanced",
		budgets,
		prompt,
		systemPrompt: "Read-only review role.",
		resultTool: tool,
		customTools: [tool],
	});
}

describe("review harness policy", () => {
	it("selects cycle count by profile and bounds focuses from sealed shape", () => {
		const small = deriveReviewBudgets("balanced", { selectedItems: 2, diffBytes: 1_000, binaryWaivers: 0 });
		const larger = deriveReviewBudgets("balanced", { selectedItems: 100, diffBytes: 400_000, binaryWaivers: 3 });
		const thorough = deriveReviewBudgets("thorough", { selectedItems: 8, diffBytes: 20_000, binaryWaivers: 0 });
		expect(small.maxCycles).toBe(1);
		expect(thorough.maxCycles).toBe(3);
		expect(small.maxFocuses).toBeGreaterThanOrEqual(3);
		expect(small.maxConcurrency).toBe(4);
		expect(larger.maxFocuses).toBeGreaterThan(small.maxFocuses);
		expect(larger.maxFocuses).toBeLessThanOrEqual(26);
		expect(larger.maxConcurrency).toBe(6);
		expect(thorough.maxConcurrency).toBe(6);
	});

	it("measures packaged instructions and the full typed tool signature", () => {
		const value = envelope("Review a small diff.");
		expect(value.resultToolBytes).toBeGreaterThan(100);
		expect(value.promptBytes).toBeGreaterThan(value.resultToolBytes);
	});

	it("does not refuse a launch because estimated tokens exceed a former review ceiling", () => {
		const value = envelope("Review a later focus after earlier work already spent tokens.");
		expect(value).not.toHaveProperty("maxTurns");
		expect(value).not.toHaveProperty("reservationTokens");
		expect(value).not.toHaveProperty("maxTokens");
		expect(value).not.toHaveProperty("remainingSeconds");
	});

	it("rejects a prompt that cannot fit the resolved model context window", () => {
		expect(() => envelope("x".repeat(300_000))).toThrow(/context window/i);
	});
});
