import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { createTlcTool } from "../src/index.js";
import { parseTlcOutput, runTlc, type TlcResult } from "../src/tlc.js";

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

function spec(name: string, bound: string) {
	const path = join(dir, `${name}.tla`);
	writeFileSync(path, counter(bound));
	writeFileSync(join(dir, `${name}.cfg`), "INIT Init\nNEXT Next\nINVARIANT Small\nCHECK_DEADLOCK FALSE\n");
	return path;
}

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
		"13 states generated, 10 distinct states found, 2 states left on queue.",
		"The depth of the complete state graph search is 5.",
	].join("\n");
	const result = parseTlcOutput(output, 12);
	expect(result).toMatchObject({
		verdict: "violation",
		property: "Small",
		stats: { generated: 13, distinct: 10, left: 2, depth: 5 },
	});
	expect(result.trace).toEqual([
		{ number: 1, action: "Initial predicate", variables: { x: "0", ledger: "[a |-> 1, b |-> 2]" } },
		{ number: 2, action: "Inc", variables: { x: "1", ledger: "[a |-> 1, b |-> 2]" } },
	]);
	expect(parseTlcOutput("Error: Deadlock reached.\nState 1: <Initial predicate>\nx = 0\n", 11)).toMatchObject({
		verdict: "deadlock",
		trace: [{ number: 1, action: "Initial predicate", variables: { x: "0" } }],
	});
	expect(parseTlcOutput("***Parse Error***\nError: Parsing or semantic analysis failed.\n", 150)).toMatchObject({
		verdict: "error",
		message: "***Parse Error***",
	});
	expect(parseTlcOutput("Model checking completed. No error has been found.\n", 1).verdict).toBe("error");
});

test("a model that keeps its invariant passes after an exhaustive search", async () => {
	const result = await runTlc({ spec: spec("Holds", "6") });
	expect(result.verdict, result.output).toBe("pass");
	expect(result.stats).toMatchObject({ distinct: 12, left: 0 });
	expect(result.trace).toEqual([]);
}, 120_000);

test("the tool reports a violation with the shortest trace, each state with its action and values", async () => {
	spec("Breaks", "4");
	const run = await createTlcTool().execute("call", { spec: "Breaks.tla" }, undefined, undefined, {
		cwd: dir,
	} as never);
	const details = run.details as TlcResult;
	expect(details).toMatchObject({ verdict: "violation", property: "Small" });
	const last = details.trace.at(-1)!.variables;
	expect(Number(last.x) + Number(last.y)).toBe(4);
	expect(details.trace).toHaveLength(5);
	expect(details.trace[0]).toEqual({ number: 1, action: "Initial predicate", variables: { x: "0", y: "0" } });
	expect(run.content[0]?.type === "text" && run.content[0].text).toContain("Counterexample:");
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
