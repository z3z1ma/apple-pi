import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { runTlc } from "../components/tla/src/tlc.js";

const model = resolve("specs/command-journal.tla");
const configuration = resolve("specs/command-journal.cfg");

test("the command journal model exhausts its finite crash/replay state space", async () => {
	const result = await runTlc({ spec: model, config: configuration });
	expect(result.verdict, result.output).toBe("pass");
	expect(result.stats?.left).toBe(0);
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
	test(`TLC reports the violation and its trace for ${fault.name}`, async () => {
		const scratch = await mkdtemp(join(tmpdir(), "apple-pi-tlc-fault-"));
		try {
			const source = await readFile(model, "utf8");
			expect(source.split(fault.before)).toHaveLength(2);
			const spec = join(scratch, "command-journal.tla");
			const config = join(scratch, "command-journal.cfg");
			await writeFile(spec, source.replace(fault.before, fault.after));
			await writeFile(config, (await readFile(configuration, "utf8")).replace("{first, second}", "{first}"));
			const result = await runTlc({ spec, config });
			expect(result.verdict, result.output).toBe("violation");
			expect(result.property).toBe(fault.violation);
			expect(result.trace[0]?.action).toBe("Initial predicate");
		} finally {
			await rm(scratch, { recursive: true, force: true });
		}
	}, 120_000);
}
