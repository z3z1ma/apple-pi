import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { createTlcTool } from "../src/index.js";
import { parseTlcOutput, runTlc } from "../src/tlc.js";
import { configWith, type TlaResult } from "../src/toolchain.js";

const dir = mkdtempSync(join(tmpdir(), "tlc-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const counter = (bound: string) => `---- MODULE Counter ----
EXTENDS Naturals
VARIABLES x, y
Init == x = 0 /\\ y = 0
Inc == x < 3 /\\ x' = x + 1 /\\ y' = y
Bump == y < 2 /\\ y' = y + 1 /\\ x' = x
Next == Inc \\/ Bump
Small == x + y < ${bound}
====
`;

function write(name: string, source: string, config: string) {
	const folder = join(dir, name);
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, "spec.tla"), source);
	writeFileSync(join(folder, "spec.cfg"), config);
	return join(folder, "spec.tla");
}

const spec = (name: string, bound: string) =>
	write(name, counter(bound), "INIT Init\nNEXT Next\nINVARIANT Small\nCHECK_DEADLOCK FALSE\n");

const sized = `---- MODULE Sized ----
EXTENDS Naturals
CONSTANT N
VARIABLES x
Init == x = 0
Inc == x < N /\\ x' = x + 1
Reset == x > 100 /\\ x' = 0
Next == Inc \\/ Reset
Bounded == x <= N
Small == x < 5
====
`;

const sizedConfig = "\\* N = 9\nCONSTANT N = 3\nINIT Init\nNEXT Next\nINVARIANT Bounded\nCHECK_DEADLOCK FALSE\n";

test("TLC's text reads as a verdict, the violated invariant, the trace and the counts", () => {
	const output = [
		"Error: Invariant Small is violated.",
		"Error: The behavior up to this point is:",
		"State 1: <Initial predicate>",
		"/\\ x = 0",
		"/\\ ledger = [a |-> 1,",
		"     b |-> 2]",
		"",
		"State 2: <Inc line 5, col 8 to line 5, col 36 of module Counter>",
		"/\\ x = 1",
		"/\\ ledger = [a |-> 1, b |-> 2]",
		"",
		"13,456 states generated, 10 distinct states found, 2 states left on queue.",
		"The depth of the complete state graph search is 5.",
	].join("\n");
	const result = parseTlcOutput(output, 12);
	expect(result).toMatchObject({
		verdict: "violation",
		property: "Small",
		stats: { generated: 13456, distinct: 10, left: 2, depth: 5 },
	});
	expect(result.trace).toEqual([
		{ number: 1, action: "Initial predicate", variables: { x: "0", ledger: "[a |-> 1, b |-> 2]" } },
		{ number: 2, action: "Inc", variables: { x: "1", ledger: "[a |-> 1, b |-> 2]" } },
	]);
	expect(parseTlcOutput("Error: Deadlock reached.\nState 1: <Initial predicate>\nx = 0\n", 11)).toMatchObject({
		verdict: "deadlock",
		trace: [{ number: 1, action: "Initial predicate", variables: { x: "0" } }],
	});
	expect(
		parseTlcOutput("Error: Invariant Ok is violated.\nState 1:\nx = 0\n\nState 2:\nx = 1\n", 12, "depth-first").trace,
	).toEqual([
		{ number: 1, action: "", variables: { x: "0" } },
		{ number: 2, action: "", variables: { x: "1" } },
	]);
	expect(parseTlcOutput("***Parse Error***\nError: Parsing or semantic analysis failed.\n", 150)).toMatchObject({
		verdict: "error",
		message: "***Parse Error***",
	});
	expect(parseTlcOutput("Model checking completed. No error has been found.\n", 1).verdict).toBe("error");
});

test("constant overrides replace the .cfg's live assignment and leave its comments alone", () => {
	expect(configWith(sizedConfig, { constants: { N: "5" } })).toBe(
		"\\* N = 9\nCONSTANT N = 5\nINIT Init\nNEXT Next\nINVARIANT Bounded\nCHECK_DEADLOCK FALSE\n",
	);
	expect(configWith("CONSTANTS\n  Procs = {p1,\n    p2}\n  Max = 2\n", { constants: { Procs: "{p1, p2, p3}" } })).toBe(
		"CONSTANTS\n  Procs = {p1, p2, p3}\n  Max = 2\n",
	);
	const added = configWith("INIT Init\nCHECK_DEADLOCK FALSE\n", {
		constants: { Max: "4" },
		checkDeadlock: true,
		invariants: ["A", "B"],
		properties: ["Live"],
	});
	expect(added.split("\n").filter(Boolean)).toEqual([
		"INIT Init",
		"CONSTANT Max = 4",
		"CHECK_DEADLOCK TRUE",
		"INVARIANT A B",
		"PROPERTY Live",
	]);
	expect(() => configWith("", { constants: { "N = 1\nINIT": "2" } })).toThrow(/identifier/);
});

test("a model that keeps its invariant passes after an exhaustive search", async () => {
	const result = await runTlc({ spec: spec("Holds", "6") });
	expect(result.verdict, result.output).toBe("pass");
	expect(result.stats).toMatchObject({ distinct: 12, left: 0 });
	expect(result.trace).toEqual([]);
	expect(result.unused).toEqual([]);
}, 120_000);

test("the tool reports a violation with the shortest trace, each state with its action and values", async () => {
	spec("Breaks", "4");
	const run = await createTlcTool().execute("call", { spec: "Breaks/spec.tla", workers: 1 }, undefined, undefined, {
		cwd: dir,
	} as never);
	const details = run.details as TlaResult;
	expect(details).toMatchObject({ verdict: "violation", property: "Small" });
	const last = details.trace.at(-1)!.variables;
	expect(Number(last.x) + Number(last.y)).toBe(4);
	expect(details.trace).toHaveLength(5);
	expect(details.trace[0]).toEqual({ number: 1, action: "Initial predicate", variables: { x: "0", y: "0" } });
	expect(run.content[0]?.type === "text" && run.content[0].text).toContain("Counterexample:");
}, 120_000);

test("a spec extends modules beside it under any file name, and the community modules", async () => {
	const main = write(
		"Modules",
		`---- MODULE Main ----
EXTENDS Naturals, QueueLib
VARIABLES q
Init == q = <<>>
Next == Len(q) < 3 /\\ q' = Push(q, Len(q))
Ok == ToSet(q) \\subseteq 0..2 /\\ SumSet(ToSet(q)) <= 3 /\\ IsInjective(q)
====
`,
		"INIT Init\nNEXT Next\nINVARIANT Ok\nCHECK_DEADLOCK FALSE\n",
	);
	writeFileSync(
		join(dir, "Modules", "queue-lib.tla"),
		"---- MODULE QueueLib ----\nEXTENDS Sequences, SequencesExt, FiniteSetsExt, Functions\nPush(q, v) == Append(q, v)\n====\n",
	);
	const result = await runTlc({ spec: main });
	expect(result.verdict, result.output).toBe("pass");
	expect(result.stats?.distinct).toBe(4);
}, 120_000);

test("an action that never takes a step is reported", async () => {
	const result = await runTlc({ spec: write("Vacuous", sized, sizedConfig) });
	expect(result.verdict, result.output).toBe("pass");
	expect(result.unused).toEqual(["Reset (line 7 of Sized)"]);
}, 120_000);

test("constants, invariants and deadlock checking are set per run without editing the .cfg", async () => {
	const path = write("Overrides", sized, sizedConfig);
	const larger = await runTlc({ spec: path, constants: { N: "6" }, invariants: ["Small"] });
	expect(larger).toMatchObject({ verdict: "violation", property: "Small" });
	expect(larger.trace.at(-1)?.variables.x).toBe("5");
	expect((await runTlc({ spec: path, checkDeadlock: true })).verdict).toBe("deadlock");
}, 120_000);

const large = `---- MODULE Large ----
EXTENDS Naturals
VARIABLES a, b, c
Init == a = 0 /\\ b = 0 /\\ c = 0
Next == \\/ a < 400 /\\ a' = a + 1 /\\ UNCHANGED <<b, c>>
        \\/ b < 400 /\\ b' = b + 1 /\\ UNCHANGED <<a, c>>
        \\/ c < 400 /\\ c' = c + 1 /\\ UNCHANGED <<a, b>>
Below == a + b + c < 1000
====
`;

test("a time limit stops an exhaustive search as incomplete, with the counts reached", async () => {
	const result = await runTlc({
		spec: write("Large", large, "INIT Init\nNEXT Next\nINVARIANT Below\n"),
		timeLimit: 1,
	});
	expect(result.verdict, result.output).toBe("incomplete");
	expect(result.stats?.left).toBeGreaterThan(0);
	expect(result.message).toMatch(/time limit/);
}, 120_000);

test("simulation and depth-first searches report incomplete unless they find a violation", async () => {
	const path = write("Bounded", large, "INIT Init\nNEXT Next\nINVARIANT Below\n");
	const simulated = await runTlc({ spec: path, mode: "simulate", traces: 20, depth: 30, seed: 7 });
	expect(simulated).toMatchObject({ verdict: "incomplete", seed: "7" });
	expect(simulated.stats?.generated).toBeGreaterThan(0);
	const shallow = await runTlc({ spec: path, mode: "depth-first", depth: 5 });
	expect(shallow.verdict, shallow.output).toBe("incomplete");
	const found = await runTlc({ spec: spec("Simulated", "3"), mode: "simulate", traces: 100 });
	expect(found).toMatchObject({ verdict: "violation", property: "Small" });
	await expect(runTlc({ spec: path, mode: "simulate" })).rejects.toThrow(/traces or timeLimit/);
}, 120_000);

test("the skill's example finds the interleaving that loses an update", async () => {
	const result = await runTlc({ spec: "skills/formal-verification/examples/lost-update.tla" });
	expect(result).toMatchObject({ verdict: "violation", property: "BothCounted" });
	expect(result.trace.at(-1)?.variables.counter).toBe("1");
}, 120_000);

test("cancelling stops the run", async () => {
	const controller = new AbortController();
	const running = runTlc({ spec: spec("Cancelled", "6"), signal: controller.signal });
	controller.abort();
	await expect(running).rejects.toThrow();
}, 120_000);
