import { describe, expect, it } from "vitest";
import { DEFAULT_RALPH_BUDGETS, deriveRalphBudgets } from "../src/controller.js";

describe("Ralph harness policy", () => {
	it("records step as a single iteration and does not scale resource fields from graph shape", () => {
		const auto = deriveRalphBudgets("auto");
		const step = deriveRalphBudgets("step");
		expect(step.maxIterations).toBe(1);
		expect(auto.maxIterations).toBe(DEFAULT_RALPH_BUDGETS.maxIterations);
		expect(auto.maxTokens).toBe(DEFAULT_RALPH_BUDGETS.maxTokens);
		expect(auto.executorMaxTurns).toBe(DEFAULT_RALPH_BUDGETS.executorMaxTurns);
		expect(auto.timeoutSeconds).toBe(DEFAULT_RALPH_BUDGETS.timeoutSeconds);
	});
});
