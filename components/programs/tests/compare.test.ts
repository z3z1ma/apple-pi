import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { type ComparisonPlan, comparisonReport, placeProgram, type Sample, usedProgram } from "../src/compare.js";

const dirs: string[] = [];
const temp = () => {
	const dir = mkdtempSync(join(tmpdir(), "compare-unit-"));
	dirs.push(dir);
	return dir;
};
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const program = { name: "dependency-chain", source: '// @program: {"description": "x"}\nreturn 1;\n' };

test("a direct call or a script call of the program's tool counts as using it, under its normalized name", () => {
	expect(usedProgram([{ ref: "pi.program_dependency_chain", args: {} }], "dependency-chain")).toBe(true);
	expect(
		usedProgram(
			[{ ref: "pi.codemode", args: { code: "await tools.program_dependency_chain({})" } }],
			"dependency-chain",
		),
	).toBe(true);
	expect(usedProgram([{ ref: "pi.program_dependency-chain", args: {} }], "dependency-chain")).toBe(false);
	expect(usedProgram([{ ref: "pi.read", args: { path: "x" } }], "dependency-chain")).toBe(false);
});

test("the program is written into the worktree's own programs directory and removed from the other arm", () => {
	const copy = temp();
	placeProgram(copy, program, "with");
	const file = join(copy, ".pi", "programs", "dependency-chain.js");
	expect(readFileSync(file, "utf8")).toBe(program.source);
	placeProgram(copy, program, "without");
	expect(existsSync(file)).toBe(false);
});

test("a programs directory that resolves outside the worktree is refused, and nothing is written there", () => {
	const copy = temp();
	const outside = temp();
	mkdirSync(join(copy, ".pi"));
	symlinkSync(outside, join(copy, ".pi", "programs"));
	expect(() => placeProgram(copy, program, "with")).toThrow(/outside the comparison's worktree/);
	expect(existsSync(join(outside, "dependency-chain.js"))).toBe(false);
});

test("the report lists every run with its measurements, under per-arm totals", () => {
	const plan = { name: "x", tasks: [{ task: "Fix it", check: "true" }], samples: 3, base: "abc" } as ComparisonPlan;
	const run = (arm: Sample["arm"], correct: boolean, toolCalls: number): Sample => ({
		task: 0,
		arm,
		correct,
		completed: true,
		usedProgram: arm === "with",
		toolCalls,
		tokens: 100,
		cost: 0.5,
		seconds: 30,
	});
	const report = comparisonReport(plan, [run("with", true, 3), run("without", false, 9), run("with", true, 4)]);
	expect(report).toContain("with: 2/2 correct");
	expect(report).toContain("without: 0/1 correct");
	expect(report).toContain("correct; 3 tool calls, 100 tokens, $0.50, 30 s, used the program");
	expect(report).toContain("incorrect; 9 tool calls");
});
