import { resolve } from "node:path";
import { expect, test } from "vitest";
import { runTlc } from "../components/formal-verification/src/tlc.js";

for (const model of ["review-lifecycle", "departure-lifecycle"]) {
	test(`${model} exhausts its finite safety model`, async () => {
		const result = await runTlc({ spec: resolve(`specs/${model}.tla`), config: resolve(`specs/${model}.cfg`) });
		expect(result.verdict, result.output).toBe("pass");
		expect(result.stats?.left).toBe(0);
	}, 120_000);
}

test("a review wait always ends, and needs both the silence watchdog and SIGKILL escalation to", async () => {
	const spec = resolve("specs/review-wait.tla");
	const config = resolve("specs/review-wait.cfg");
	const result = await runTlc({ spec, config });
	expect(result.verdict, result.output).toBe("pass");
	expect(result.unused).toEqual([]);
	for (const missing of ["WatchdogOn", "KillEscalation"]) {
		const without = await runTlc({ spec, config, constants: { [missing]: "FALSE" } });
		expect(without.verdict, missing).toBe("violation");
		expect(without.message).toMatch(/[Tt]emporal/);
	}
}, 300_000);
