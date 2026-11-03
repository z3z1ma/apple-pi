import { appendFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { expect } from "vitest";

export function budget(name: string, value: number, ceiling: number, details: Record<string, unknown> = {}) {
	if (process.env.APPLE_PI_BUDGET_REPORT)
		appendFileSync(process.env.APPLE_PI_BUDGET_REPORT, `${JSON.stringify({ name, value, ceiling, ...details })}\n`);
	expect(Number.isFinite(value), `${name}: finite measurement`).toBe(true);
	expect(value, `${name}: ${value} exceeds ${ceiling}; see the build-budgets ledger record`).toBeLessThanOrEqual(
		ceiling,
	);
}

export async function latency(operation: () => unknown | Promise<unknown>) {
	for (let i = 0; i < 3; i++) await operation();
	const samples: number[] = [];
	for (let i = 0; i < 20; i++) {
		const start = performance.now();
		await operation();
		samples.push(performance.now() - start);
	}
	const sorted = [...samples].sort((a, b) => a - b);
	return { p95: sorted[Math.ceil(sorted.length * 0.95) - 1]!, samples };
}
