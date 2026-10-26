import { expect, test } from "vitest";
import { readValuation, worthLines } from "../src/valuation.js";

const goal = (header: string) =>
	`Status: in-progress\nCreated: 2026-10-26\n${header}\n# Fix flaky test\n\n## Intent\n\nValue: $999\n`;

test("a task's value and cost of delay come from its header, with the estimate's author when marked", () => {
	expect(readValuation(goal("Value: $50 (estimated by Ada Lovelace)\nCost of delay: $5/hour"))).toEqual({
		value: 50,
		costOfDelayPerHour: 5,
		estimatedBy: "Ada Lovelace",
	});
	expect(readValuation(goal("Value: $50\nCost of delay: $48/day"))).toEqual({
		value: 50,
		costOfDelayPerHour: 2,
		estimatedBy: null,
	});
});

test("a missing or unreadable value is unvalued, $0 is a value, and a value alone has no cost of delay", () => {
	expect(readValuation(goal("")).value).toBeNull();
	expect(readValuation(goal("Value: fifty")).value).toBeNull();
	expect(readValuation(goal("Value: $0"))).toEqual({ value: 0, costOfDelayPerHour: 0, estimatedBy: null });
	expect(readValuation(goal("Value: $50"))).toEqual({ value: 50, costOfDelayPerHour: 0, estimatedBy: null });
	expect(readValuation(goal("Value: $50\nCost of delay: soon")).costOfDelayPerHour).toBe(0);
	expect(readValuation(goal("Value: $5-0")).value).toBeNull();
});

test("every amount the writer accepts reads back as written, however large or small", () => {
	for (const worth of [
		{ value: 1e21, cost_of_delay: 1e-7 },
		{ value: 0.5, cost_of_delay: 0 },
	])
		expect(readValuation(goal(worthLines(worth, "Ada")))).toEqual({
			value: worth.value,
			costOfDelayPerHour: worth.cost_of_delay,
			estimatedBy: "Ada",
		});
});
