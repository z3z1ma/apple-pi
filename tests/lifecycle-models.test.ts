import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execute = promisify(execFile);

for (const model of ["review-lifecycle", "departure-lifecycle"]) {
	test(`${model} exhausts its finite safety model`, async () => {
		const result = await execute(process.execPath, [
			resolve("scripts/run-tlc.mjs"),
			resolve(`specs/${model}.tla`),
			resolve(`specs/${model}.cfg`),
		]);
		const output = result.stdout + result.stderr;
		expect(output).toContain("Model checking completed. No error has been found.");
		expect(output).toMatch(/\d+ distinct states found, 0 states left on queue/);
	}, 120_000);
}
