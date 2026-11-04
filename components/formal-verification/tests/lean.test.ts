import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { createLeanTool } from "../src/index.js";
import { declaredTheorems, LEAN_TOOLCHAIN, runLean } from "../src/lean.js";

const dir = mkdtempSync(join(tmpdir(), "lean-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function check(name: string, source: string, folder = dir) {
	const file = join(folder, `${name}.lean`);
	writeFileSync(file, source);
	return runLean({ file, source: readFileSync(file, "utf8") });
}

const merge = `def mergePriority (a b : Nat) : Nat := max a b

namespace Merge
theorem comm (a b : Nat) : mergePriority a b = mergePriority b a := by
  simp [mergePriority, Nat.max_comm]

@[simp] theorem idem (a : Nat) : mergePriority a a = a := by
  simp [mergePriority]
end Merge
`;

test("declared theorems carry their namespaces and skip comments", () => {
	expect(
		declaredTheorems(`namespace A.B
-- theorem commented : True := trivial
/- theorem blocked : True := trivial -/
section
private theorem hidden : True := trivial
end
theorem _root_.top : True := trivial
@[simp]
lemma lem : True := trivial
end A.B
theorem outside : True := trivial
`),
	).toEqual(["A.B.hidden", "top", "A.B.lem", "outside"]);
});

test("proved theorems with standard axioms pass", async () => {
	const result = await check("Merge", merge);
	expect(result.verdict).toBe("pass");
	expect(result.toolchain).toBe("Lean 4.35.0");
	expect(result.theorems.map((theorem) => theorem.name)).toEqual(["Merge.comm", "Merge.idem"]);
	expect(result.theorems.every((theorem) => theorem.axioms?.every((axiom) => axiom !== "sorryAx"))).toBe(true);
}, 900_000);

test("sorry is incomplete, not a pass", async () => {
	const result = await check(
		"Sorry",
		`${merge}theorem assoc (a b c : Nat) : max (max a b) c = max a (max b c) := by\n  sorry\n`,
	);
	expect(result.verdict).toBe("incomplete");
	expect(result.message).toContain("a declaration uses sorry");
	expect(result.theorems.find((theorem) => theorem.name === "assoc")?.axioms).toContain("sorryAx");
}, 300_000);

test("a false theorem is an error with Lean's diagnostic", async () => {
	const result = await check("False", "theorem wrong (a : Nat) : max a 0 = 0 := by\n  simp\n");
	expect(result.verdict).toBe("error");
	expect(result.diagnostics.find((diagnostic) => diagnostic.severity === "error")).toMatchObject({ line: 1 });
}, 300_000);

test("a theorem that rests on a custom axiom is incomplete", async () => {
	const result = await check(
		"Axiom",
		"axiom trust : \u2200 n : Nat, n = n + 0\ntheorem usesAxiom (n : Nat) : n = n + 0 := trust n\n",
	);
	expect(result.verdict).toBe("incomplete");
	expect(result.theorems).toEqual([{ name: "usesAxiom", axioms: ["trust"] }]);
}, 300_000);

test("a file with no theorem is incomplete, and an unknown theorem name is not audited", async () => {
	expect((await check("Defs", "def double (n : Nat) := 2 * n\n")).verdict).toBe("incomplete");
	const file = join(dir, "Merge.lean");
	const result = await runLean({ file, source: merge, theorems: ["Merge.comm", "Merge.missing"] });
	expect(result.verdict).toBe("incomplete");
	expect(result.theorems[1]).toMatchObject({
		name: "Merge.missing",
		problem: expect.stringMatching(/Unknown constant/),
	});
}, 300_000);

test("a file in a Lake project imports the project's modules after lake build", async () => {
	const project = join(dir, "project");
	mkdirSync(join(project, "Demo"), { recursive: true });
	writeFileSync(join(project, "lean-toolchain"), `${LEAN_TOOLCHAIN}\n`);
	writeFileSync(
		join(project, "lakefile.toml"),
		'name = "demo"\ndefaultTargets = ["Demo"]\n\n[[lean_lib]]\nname = "Demo"\n',
	);
	writeFileSync(join(project, "Demo.lean"), "import Demo.Basic\n");
	writeFileSync(join(project, "Demo", "Basic.lean"), "def Demo.double (n : Nat) : Nat := n + n\n");
	const file = join(project, "Check.lean");
	writeFileSync(file, "import Demo\ntheorem double_two : Demo.double 2 = 4 := rfl\n");
	const tool = createLeanTool();
	const result = await tool.execute("call", { file: "Check.lean", build: true }, undefined, undefined, {
		cwd: project,
	} as never);
	const text = (result.content[0] as { text: string }).text;
	expect(text).toMatch(/: PASS\./);
	expect(text).toContain(`Project: ${project}.`);
	expect(text).toContain("double_two: axioms none");
}, 600_000);

test("the skill's example proves the merge laws", async () => {
	const file = "skills/formal-verification/examples/merge.lean";
	const result = await runLean({ file, source: readFileSync(file, "utf8") });
	expect(result.verdict).toBe("pass");
	expect(result.theorems.map((theorem) => theorem.name)).toEqual(["merge_comm", "merge_assoc", "merge_idem"]);
}, 300_000);
