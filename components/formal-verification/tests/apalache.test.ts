import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { configInvariants, itfValue, runApalache } from "../src/apalache.js";
import { createSymbolicTool } from "../src/index.js";
import type { TlaResult } from "../src/toolchain.js";

const dir = mkdtempSync(join(tmpdir(), "apalache-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const doubling = `---- MODULE Doubling ----
EXTENDS Integers
CONSTANT
    \\* @type: Int;
    N
VARIABLES
    \\* @type: Int;
    x,
    \\* @type: Int;
    y
Init == x = 0 /\\ y = 0
Next == x < N /\\ x' = x + 1 /\\ y' = y + 2
Safe == y <= 2 * N
Small == x < 3
IndInv == x \\in 0..N /\\ y = 2 * x
Loose == x \\in 0..N /\\ y \\in 0..(2 * N)
AnyN == N \\in Nat /\\ N > 0
SomeN == N \\in 1..1000
====
`;

function write(name: string, source: string, config?: string) {
	const folder = join(dir, name);
	mkdirSync(folder, { recursive: true });
	writeFileSync(join(folder, "doubling.tla"), source);
	if (config) writeFileSync(join(folder, "doubling.cfg"), config);
	return join(folder, "doubling.tla");
}

const spec = write("Doubling", doubling);

test("ITF values read as TLA+ and the .cfg's invariants are found", () => {
	expect(
		itfValue({
			n: { "#bigint": "12345678901234567890" },
			s: { "#set": ["a", "b"] },
			t: { "#tup": [true, false] },
			f: { "#map": [[{ "#bigint": "1" }, "x"]] },
			q: [{ "#bigint": "1" }],
		}),
	).toBe('[n |-> 12345678901234567890, s |-> {"a", "b"}, t |-> <<TRUE, FALSE>>, f |-> (1 :> "x"), q |-> <<1>>]');
	expect(configInvariants("\\* INVARIANT Old\nINIT Init\nINVARIANTS A\n  B\nPROPERTY Live\nINVARIANT C\n")).toEqual([
		"A",
		"B",
		"C",
	]);
});

test("a bounded check finds the violation and the constant value that shows it", async () => {
	const run = await createSymbolicTool().execute(
		"call",
		{ spec: "Doubling/doubling.tla", constInit: "SomeN", invariants: ["Small"], length: 5, checkDeadlock: false },
		undefined,
		undefined,
		{ cwd: dir } as never,
	);
	const result = run.details as TlaResult;
	expect(result).toMatchObject({ verdict: "violation", property: "Small" });
	expect(result.trace[0]).toMatchObject({ number: 1, action: "Init", variables: { x: "0", y: "0" } });
	expect(result.trace.at(-1)?.variables.x).toBe("3");
	expect(Number(result.trace.at(-1)?.variables.N)).toBeGreaterThanOrEqual(3);
	expect(run.content[0]?.type === "text" && run.content[0].text).toContain("Counterexample:");
}, 180_000);

test("a bounded check without a violation is incomplete unless every behavior ends within the length", async () => {
	const open = await runApalache({ spec, constInit: "SomeN", invariants: ["Safe"], length: 3, checkDeadlock: false });
	expect(open.verdict, open.output).toBe("incomplete");
	const short = await runApalache({
		spec,
		constants: { N: "2" },
		invariants: ["Safe"],
		length: 5,
		checkDeadlock: false,
	});
	expect(short.verdict, short.output).toBe("pass");
	const stuck = await runApalache({ spec, constants: { N: "1" }, invariants: ["Safe"], length: 4 });
	expect(stuck.verdict, stuck.output).toBe("deadlock");
}, 180_000);

test("an inductive invariant proves the property for every N and every behavior length", async () => {
	const result = await runApalache({
		spec,
		mode: "inductive",
		constInit: "AnyN",
		inductive: "IndInv",
		invariants: ["Safe"],
	});
	expect(result.verdict, result.output).toBe("pass");
	expect(result.message).toMatch(/^Proved: Init establishes IndInv/);
}, 180_000);

test("an invariant that is not inductive comes back with the state a step breaks it from", async () => {
	const result = await runApalache({
		spec,
		mode: "inductive",
		constInit: "AnyN",
		inductive: "Loose",
		invariants: ["Safe"],
	});
	expect(result).toMatchObject({ verdict: "violation", property: "Loose" });
	expect(result.message).toMatch(/Loose is not inductive.* The broken part: /);
	expect(result.trace).toHaveLength(2);
	expect(result.trace[0]?.action).toMatch(/^Loose \(any state satisfying it/);
}, 180_000);

test("the skill's example, read by the .cfg, loses an update within four steps", async () => {
	const result = await runApalache({
		spec: "skills/formal-verification/examples/lost-update.tla",
		length: 4,
		checkDeadlock: false,
	});
	expect(result).toMatchObject({ verdict: "violation", property: "BothCounted" });
	expect(result.trace.at(-1)?.variables.counter).toBe("1");
}, 180_000);

test("a type error, a time limit and a missing invariant are reported, not read as success", async () => {
	const typed = await runApalache({
		spec: write("Typed", doubling.replace("Init == x = 0", 'Init == x = "zero"')),
		constInit: "SomeN",
		invariants: ["Safe"],
	});
	expect(typed.verdict).toBe("error");
	expect(typed.message).toMatch(/type/i);
	const slow = await runApalache({ spec, constInit: "AnyN", invariants: ["Safe"], length: 200, timeLimit: 1 });
	expect(slow.verdict, slow.output).toBe("incomplete");
	expect(slow.message).toMatch(/time limit/);
	await expect(runApalache({ spec, mode: "inductive", invariants: ["Safe"] })).rejects.toThrow(/inductive/);
}, 180_000);
