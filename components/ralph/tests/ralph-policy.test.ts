import { describe, expect, it } from "vitest";
import { deriveRalphBudgets } from "../src/controller.js";

describe("Ralph harness policy", () => {
	it("derives bounded internal limits from mode and compiled graph shape", () => {
		const small = deriveRalphBudgets("auto", { records: [{}] as any, byteLength: 1_000 });
		const large = deriveRalphBudgets("auto", {
			records: Array.from({ length: 32 }, () => ({})) as any,
			byteLength: 250_000,
		});
		const step = deriveRalphBudgets("step", { records: [{}] as any, byteLength: 1_000 });
		expect(step.maxIterations).toBe(1);
		expect(large.maxTokens).toBeGreaterThan(small.maxTokens);
		expect(large.executorMaxTurns).toBeGreaterThan(small.executorMaxTurns);
		expect(large.maxIterations).toBeLessThanOrEqual(10);
	});
});
