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
