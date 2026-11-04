import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { runAlloy } from "../src/alloy.js";
import { createAlloyTool } from "../src/index.js";

const dir = mkdtempSync(join(tmpdir(), "alloy-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function model(name: string, source: string): string {
	const path = join(dir, `${name}.als`);
	writeFileSync(path, source);
	return path;
}

const graph = (facts: string) => `sig Task { dependsOn: set Task }
${facts}
assert Acyclic { no t: Task | t in t.^dependsOn }
check Acyclic for 4
run SomeDependency { some dependsOn } for 3
`;

test("a check passes when the facts rule out every counterexample within the scope", async () => {
	const result = await runAlloy({ spec: model("acyclic", graph("fact { no t: Task | t in t.^dependsOn }")) });
	expect(result.verdict).toBe("pass");
	expect(result.commands.map((command) => [command.name, command.outcome])).toEqual([
		["Acyclic", "no counterexample"],
		["SomeDependency", "instance"],
	]);
}, 120_000);

test("removing the fact yields a counterexample with the cycle", async () => {
	const result = await runAlloy({ spec: model("cyclic", graph("")) });
	expect(result.verdict).toBe("violation");
	const check = result.commands.find((command) => command.name === "Acyclic");
	expect(check?.outcome).toBe("counterexample");
	expect(check?.instance).toMatch(/^Task<:dependsOn=\{Task\$\d+->Task\$\d+/m);
	expect(check?.instance).toMatch(/^skolem \$Acyclic_t=\{Task\$\d+\}$/m);
	expect(check?.instance).not.toMatch(/^univ=|^Int=/m);
}, 120_000);

test("expect turns a known counterexample into a passing negative control", async () => {
	const result = await runAlloy({
		spec: model(
			"expected",
			"sig Task { dependsOn: set Task }\nassert Acyclic { no t: Task | t in t.^dependsOn }\ncheck Acyclic for 3 expect 1\nrun {} for 2 expect 1\n",
		),
	});
	expect(result.verdict).toBe("pass");
	expect(result.commands[0]).toMatchObject({ outcome: "counterexample", expected: "instance" });
}, 120_000);

test("a run with no instance is reported and an unmet expect is a violation", async () => {
	const result = await runAlloy({
		spec: model("empty", "sig A {}\nfact { no A }\nrun { some A } for 3\nrun { some A } for 3 expect 1\n"),
	});
	expect(result.commands.map((command) => command.outcome)).toEqual(["no instance", "no instance"]);
	expect(result.verdict).toBe("violation");
	const tool = createAlloyTool();
	const only = await tool.execute("call", { spec: join(dir, "empty.als"), commands: ["0"] }, undefined, undefined, {
		cwd: dir,
	} as never);
	const text = (only.content[0] as { text: string }).text;
	expect(text).toMatch(/^Alloy 6\.2\.0 on .*empty\.als: PASS\./);
	expect(text).toContain("No instance for run$1: the facts may rule out everything it asks for");
}, 120_000);

test("a temporal counterexample comes back state by state", async () => {
	const result = await runAlloy({
		spec: model(
			"temporal",
			`sig Worker {}
var sig Busy in Worker {}
fact { no Busy }
fact transitions { always (Busy' = Busy or some w: Worker | w not in Busy and Busy' = Busy + w) }
assert NeverTwoBusy { always lone Busy }
check NeverTwoBusy for 3 but 5 steps
`,
		),
	});
	expect(result.verdict).toBe("violation");
	expect(result.commands[0].instance).toMatch(/^State 0:$/m);
	expect(result.commands[0].instance).toMatch(/^State \d+ \(loop\):$/m);
	expect(result.commands[0].instance).toMatch(/^Busy=\{Worker\$\d+, Worker\$\d+/m);
}, 120_000);

test("a model that does not parse is an error with its position", async () => {
	const result = await runAlloy({ spec: model("broken", "sig A { f: B }\nrun {}\n") });
	expect(result.verdict).toBe("error");
	expect(result.message).toMatch(/line 1 column 12/);
	expect(result.message).toContain('The name "B" cannot be found.');
	expect(result.message).not.toMatch(/^\s+at /m);
}, 120_000);

test("the skill's example finds the cycle its self-dependency rule misses", async () => {
	const result = await runAlloy({ spec: "skills/formal-verification/examples/dependency-graph.als" });
	expect(result.verdict).toBe("violation");
	expect(result.commands.map((command) => [command.name, command.outcome])).toEqual([
		["NoCycles", "counterexample"],
		["Chain", "instance"],
	]);
}, 120_000);
