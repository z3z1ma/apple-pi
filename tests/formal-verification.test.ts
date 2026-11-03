import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const execute = promisify(execFile);
const runner = resolve("scripts/run-tlc.mjs");
const model = resolve("specs/command-journal.tla");
const configuration = resolve("specs/command-journal.cfg");

async function check(spec: string, config = configuration) {
	try {
		const result = await execute(process.execPath, [runner, spec, config]);
		return { code: 0, output: result.stdout + result.stderr };
	} catch (error) {
		const failure = error as { code: number | string; stdout: string; stderr: string };
		return { code: failure.code, output: failure.stdout + failure.stderr };
	}
}

test("the command journal model exhausts its finite crash/replay state space", async () => {
	const result = await check(model);
	expect(result.code, result.output).toBe(0);
	expect(result.output).toContain("Model checking completed. No error has been found.");
	expect(result.output).toMatch(/\d+ distinct states found, 0 states left on queue/);
}, 120_000);

const faults = [
	{
		name: "replaying an already committed effect",
		before: '/\\ stage[c] = "accepted" /\\ result[c] = "none"',
		after: '/\\ stage[c] = "accepted"',
		violation: "NoCommandAppliedTwice",
	},
	{
		name: "committing an effect without its result",
		before: "/\\ result' = [result EXCEPT ![active] = active]",
		after: "/\\ result' = result",
		violation: "NoLostAppliedResult",
	},
	{
		name: "committing a publication without its outbox",
		before: "/\\ outbox' = outbox \\cup {active}",
		after: "/\\ outbox' = outbox",
		violation: "AtomicPublication",
	},
	{
		name: "a retry regressing an observed receipt",
		before: "/\\ receipt' = [receipt EXCEPT ![c] = stage[c]]",
		after: '/\\ receipt\' = [receipt EXCEPT ![c] = IF receipt[c] = "absent" THEN stage[c] ELSE "absent"]',
		violation: "ReceiptsMonotone",
	},
];

for (const fault of faults) {
	test(`TLC fails and prints a trace for ${fault.name}`, async () => {
		const scratch = await mkdtemp(join(tmpdir(), "apple-pi-tlc-fault-"));
		try {
			const source = await readFile(model, "utf8");
			expect(source.split(fault.before)).toHaveLength(2);
			const spec = join(scratch, "command-journal.tla");
			const config = join(scratch, "command-journal.cfg");
			await writeFile(spec, source.replace(fault.before, fault.after));
			await writeFile(config, (await readFile(configuration, "utf8")).replace("{first, second}", "{first}"));
			const result = await check(spec, config);
			expect(result.code, result.output).toBeTypeOf("number");
			expect(result.code, result.output).not.toBe(0);
			expect(result.output).toContain(fault.violation);
			expect(result.output).toContain("State 1:");
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	}, 120_000);
}
