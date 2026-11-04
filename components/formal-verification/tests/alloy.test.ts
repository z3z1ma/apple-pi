import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

test("a control check with expect 1 must find its counterexample and is not counted as a property", async () => {
	const control =
		"sig Task { dependsOn: set Task }\nassert Acyclic { no t: Task | t in t.^dependsOn }\ncheck Acyclic for 3 expect 1\nrun {} for 2\n";
	const alone = await runAlloy({ spec: model("control", control) });
	expect(alone.commands[0]).toMatchObject({ outcome: "counterexample", expected: "instance" });
	expect(alone.verdict).toBe("incomplete");
	expect(alone.message).toContain("no property check ran");
	const withProperty = await runAlloy({
		spec: model("property", `${control}assert Finite { #Task <= 3 }\ncheck Finite for 3\n`),
	});
	expect(withProperty.verdict).toBe("pass");
	expect(withProperty.message).toContain("1 control check found the expected counterexample");
}, 120_000);

test("contradictory facts never pass: checks hold vacuously when no run finds an instance", async () => {
	const contradiction = "sig A {}\nfact { some A and no A }\nassert Valid { no A }\ncheck Valid for 3\n";
	const checkOnly = await runAlloy({ spec: model("vacuous", contradiction) });
	expect(checkOnly.verdict).toBe("incomplete");
	expect(checkOnly.message).toContain("no run found an instance");
	const withRun = await runAlloy({ spec: model("vacuous-run", `${contradiction}run {} for 3\n`) });
	expect(withRun.commands.map((command) => command.outcome)).toEqual(["no counterexample", "no instance"]);
	expect(withRun.verdict).toBe("incomplete");
	expect(withRun.message).toContain("run$2 found no instance");
}, 120_000);

test("every expect is enforced, including expect 0 on a satisfiable run", async () => {
	const zero = await runAlloy({ spec: model("expect-zero", "sig A {}\nrun { some A } for 3 expect 0\n") });
	expect(zero.commands[0]).toMatchObject({ outcome: "instance", expected: "none" });
	expect(zero.verdict).toBe("violation");
	const one = await runAlloy({
		spec: model("expect-one", "sig A {}\nfact { no A }\nrun { some A } for 3 expect 1\n"),
	});
	expect(one.verdict).toBe("violation");
	expect(one.message).toContain("found none, against its expect");
}, 120_000);

test("every requested command must exist, and only solving backends are accepted", async () => {
	const spec = model("select", "sig A {}\nassert P { no A }\ncheck P for 3\nrun {} for 2\n");
	const partial = await runAlloy({ spec, commands: ["P", "DoesNotExist"] });
	expect(partial.verdict).toBe("error");
	expect(partial.message).toMatch(/^No command matches DoesNotExist;/);
	await expect(runAlloy({ spec, solver: "CNF" as never })).rejects.toThrow(/solver must be one of/);
	const tool = createAlloyTool();
	const result = await tool.execute("call", { spec: "select.als", commands: ["0"] }, undefined, undefined, {
		cwd: dir,
	} as never);
	const text = (result.content[0] as { text: string }).text;
	expect(text).toMatch(/^Alloy 6\.2\.0 on select\.als: VIOLATION\. P has a counterexample within its scope\./);
	expect(text).toMatch(/^Counterexample for P:\nA=\{A\$0\}/m);
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

function fakeJava(name: string, exec: string): string {
	const bin = join(dir, name);
	mkdirSync(bin, { recursive: true });
	const real = execFileSync("sh", ["-c", "command -v java"], { encoding: "utf8" }).trim();
	writeFileSync(
		join(bin, "java"),
		`#!/bin/sh\ncase " $* " in *" exec "*) ;; *) exec "${real}" "$@" ;; esac\nwhile [ $# -gt 0 ]; do [ "$1" = -o ] && out="$2"; shift; done\nmkdir -p "$out"\n${exec}\n`,
	);
	chmodSync(join(bin, "java"), 0o755);
	return bin;
}

async function withPath<T>(bin: string, run: () => Promise<T>): Promise<T> {
	const path = process.env.PATH;
	process.env.PATH = `${bin}:${path}`;
	try {
		return await run();
	} finally {
		process.env.PATH = path;
	}
}

test("a receipt that is not this command's solver result, or a failed exit, is an error", async () => {
	const spec = model("receipt", "sig A {}\nassert P { some A or no A }\ncheck P for 3\nrun {} for 2\n");
	const empty = fakeJava("empty-receipt", `echo '{"commands":{}}' > "$out/receipt.json"`);
	const wrong = await withPath(empty, () => runAlloy({ spec }));
	expect(wrong.verdict).toBe("error");
	expect(wrong.message).toBe("Alloy's result for P is not a solver result for that command.");
	const failing = fakeJava(
		"failing",
		`echo '{"commands":{"P":{"type":"check"}}}' > "$out/receipt.json"\necho fatal >&2\nexit 2`,
	);
	const failed = await withPath(failing, () => runAlloy({ spec }));
	expect(failed.verdict).toBe("error");
	expect(failed.message).toMatch(/^Alloy exited with status 2 on P:\nfatal/);
}, 120_000);

test("the time limit stops the whole process tree, even a child that ignores SIGTERM", async () => {
	const spec = model("stubborn", "sig A {}\nassert P { some A or no A }\ncheck P for 3\n");
	const stubborn = fakeJava("stubborn", `sh -c 'trap "" TERM; sleep 60' &\ntrap "" TERM\nwait`);
	const started = Date.now();
	const result = await withPath(stubborn, () => runAlloy({ spec, timeLimit: 1 }));
	expect(result.verdict).toBe("incomplete");
	expect(result.message).toContain("the time limit stopped P");
	expect(Date.now() - started).toBeLessThan(20_000);
}, 60_000);

test("a malformed receipt or an unexplained exit 1 is an error, never a pass", async () => {
	const spec = model("malformed", "sig A {}\nassert P { some A or no A }\ncheck P for 3\nrun {} for 2\n");
	for (const receipt of [
		'{"solver":"sat4j","commands":{"P":{"type":"check"}}}',
		'{"solver":"sat4j","commands":{"P":true}}',
		'{"solver":"sat4j","commands":{"P":{"name":"P","type":"check","solution":{}}}}',
		'{"solver":"minisat","commands":{"P":{"name":"P","type":"check"}}}',
	]) {
		const bin = fakeJava(`receipt-${receipt.length}`, `echo '${receipt}' > "$out/receipt.json"`);
		const result = await withPath(bin, () => runAlloy({ spec, commands: ["P"] }));
		expect(result.verdict, receipt).toBe("error");
	}
	const exitOne = fakeJava(
		"exit-one",
		`echo '{"solver":"sat4j","commands":{"P":{"name":"P","type":"check"}}}' > "$out/receipt.json"\necho "  0. 'Check P for 3' was not satisfied against expectation"\nexit 1`,
	);
	const result = await withPath(exitOne, () => runAlloy({ spec, commands: ["P"] }));
	expect(result.verdict).toBe("error");
	expect(result.message).toMatch(/^Alloy exited with status 1 on P/);
}, 120_000);

test("a descendant that ignores SIGTERM and detaches its output is stopped too", async () => {
	const spec = model("detached", "sig A {}\nassert P { some A or no A }\ncheck P for 3\n");
	const marker = `alloy-detached-${process.pid}`;
	const bin = fakeJava(
		"detached",
		`sh -c 'trap "" TERM; exec -a ${marker} sleep 60' </dev/null >/dev/null 2>&1 &\nsleep 60`,
	);
	const result = await withPath(bin, () => runAlloy({ spec, timeLimit: 1 }));
	expect(result.verdict).toBe("incomplete");
	expect(execFileSync("sh", ["-c", `pgrep -f ${marker} || true`], { encoding: "utf8" }).trim()).toBe("");
}, 60_000);
