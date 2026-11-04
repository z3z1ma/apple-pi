import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createLeanTool } from "../src/index.js";
import { elanHome, LEAN_TOOLCHAIN, runLean } from "../src/lean.js";

const dir = mkdtempSync(join(tmpdir(), "lean-test-"));
let realHome = "";
beforeAll(async () => {
	realHome = await elanHome();
}, 900_000);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function check(name: string, source: string, theorems?: string[]) {
	const file = join(dir, `${name}.lean`);
	writeFileSync(file, source);
	return runLean({ file, source: readFileSync(file, "utf8"), theorems });
}

const merge = `def mergePriority (a b : Nat) : Nat := max a b

namespace Merge
theorem comm (a b : Nat) : mergePriority a b = mergePriority b a := by
  simp [mergePriority, Nat.max_comm]

@[simp] theorem idem (a : Nat) : mergePriority a a = a := by
  simp [mergePriority]

private theorem hidden : True := trivial
end Merge
`;

test("proved theorems with standard axioms pass, private ones included", async () => {
	const result = await check("Merge", merge);
	expect(result.verdict).toBe("pass");
	expect(result.toolchain).toBe("Lean 4.35.0");
	expect(result.theorems.map((theorem) => theorem.name).sort()).toEqual(["Merge.comm", "Merge.hidden", "Merge.idem"]);
	expect(result.theorems.every((theorem) => theorem.axioms?.every((axiom) => axiom !== "sorryAx"))).toBe(true);
}, 300_000);

test("sorry is incomplete, even with the sorry warning switched off", async () => {
	const result = await check(
		"Sorry",
		`${merge}theorem assoc (a b c : Nat) : max (max a b) c = max a (max b c) := by\n  sorry\n`,
	);
	expect(result.verdict).toBe("incomplete");
	expect(result.theorems.find((theorem) => theorem.name === "assoc")?.axioms).toContain("sorryAx");
	const quiet = await check(
		"QuietSorry",
		"set_option warn.sorry false\ndef unfinished : Nat := sorry\ntheorem good : True := trivial\ntheorem bad : False := sorry\n",
		["good"],
	);
	expect(quiet.verdict).toBe("incomplete");
	expect(quiet.message).toContain("unfinished, bad use sorry");
}, 300_000);

test("a false theorem is an error with Lean's diagnostic", async () => {
	const result = await check("False", "theorem wrong (a : Nat) : max a 0 = 0 := by\n  simp\n");
	expect(result.verdict).toBe("error");
	expect(result.diagnostics.find((diagnostic) => diagnostic.severity === "error")).toMatchObject({ line: 1 });
}, 300_000);

test("every theorem Lean declares is audited, however the source spells it", async () => {
	const result = await check(
		"Hidden",
		`axiom trust : False
theorem good : True := trivial
def marker := "/-"
theorem bad : False := trust
theorem good2 : True := trivial theorem bad2 : False := trust
set_option pp.universes true in theorem bad3 : False := trust
theorem «does not depend on any axioms» : False := trust
theorem nd : 2 + 2 = 4 := by native_decide
namespace A
theorem good : False := trust
namespace A
theorem good : True := trivial
`,
	);
	expect(result.verdict).toBe("incomplete");
	const axioms = Object.fromEntries(result.theorems.map((theorem) => [theorem.name, theorem.axioms]));
	for (const name of ["bad", "bad2", "bad3", "«does not depend on any axioms»", "A.good"])
		expect(axioms[name], name).toEqual(["trust"]);
	expect(axioms["A.A.good"]).toEqual([]);
	expect(axioms.nd?.some((axiom) => axiom.includes("native_decide"))).toBe(true);
	expect(result.message).toContain("native_decide trusts the compiler");
}, 300_000);

test("a file with no theorem, or a requested name that is not a theorem, is incomplete", async () => {
	const defs = await check("Defs", "def double (n : Nat) := 2 * n\naxiom trust : False\n");
	expect(defs.verdict).toBe("incomplete");
	expect(defs.message).toContain("declares no theorem");
	const named = await check("Named", `${merge}def n : Nat := 5\naxiom trust : False\n`, [
		"Merge.comm",
		"n",
		"trust",
		"Merge.missing",
	]);
	expect(named.verdict).toBe("incomplete");
	expect(named.theorems.slice(1)).toEqual([
		{ name: "n", problem: "it is not a theorem" },
		{ name: "trust", problem: "it is an axiom" },
		{ name: "Merge.missing", problem: "the file declares no theorem by this name" },
	]);
}, 300_000);

function fakeHome(name: string, scripts: Record<string, string>): string {
	const home = join(dir, name);
	mkdirSync(join(home, "bin"), { recursive: true });
	for (const tool of ["elan", "lean", "lake"]) {
		const path = join(home, "bin", tool);
		writeFileSync(path, scripts[tool] ?? `#!/bin/sh\nELAN_HOME="${realHome}" exec "${realHome}/bin/${tool}" "$@"\n`);
		chmodSync(path, 0o755);
	}
	return home;
}

async function withElan<T>(home: string, run: () => Promise<T>): Promise<T> {
	const previous = process.env.ELAN_HOME;
	process.env.ELAN_HOME = home;
	try {
		return await run();
	} finally {
		if (previous === undefined) delete process.env.ELAN_HOME;
		else process.env.ELAN_HOME = previous;
	}
}

test("Lean exiting unsuccessfully after clean output is an error, not a pass", async () => {
	const home = fakeHome("failing-lean", {
		lean: `#!/bin/sh\nELAN_HOME="${realHome}" "${realHome}/bin/lean" "$@"\nstatus=$?\ncase " $* " in *" --version "*) exit $status ;; esac\nexit 7\n`,
	});
	const file = join(dir, "Merge.lean");
	writeFileSync(file, merge);
	const result = await withElan(home, () => runLean({ file, source: merge }));
	expect(result.verdict).toBe("error");
	expect(result.message).toBe("Lean exited with status 7.");
}, 300_000);

function project(name: string): string {
	const root = join(dir, name);
	mkdirSync(join(root, "Demo"), { recursive: true });
	writeFileSync(join(root, "lean-toolchain"), `${LEAN_TOOLCHAIN}\n`);
	writeFileSync(
		join(root, "lakefile.toml"),
		'name = "demo"\ndefaultTargets = ["Demo"]\n\n[[lean_lib]]\nname = "Demo"\n',
	);
	writeFileSync(join(root, "Demo.lean"), "import Demo.Basic\n");
	writeFileSync(join(root, "Demo", "Basic.lean"), "def Demo.double (n : Nat) : Nat := n + n\n");
	writeFileSync(join(root, "Check.lean"), "import Demo\ntheorem double_two : Demo.double 2 = 4 := rfl\n");
	return root;
}

test("a file in a Lake project imports the project's modules after lake build", async () => {
	const root = project("project");
	const tool = createLeanTool();
	const result = await tool.execute("call", { file: "Check.lean", build: true }, undefined, undefined, {
		cwd: root,
	} as never);
	const text = (result.content[0] as { text: string }).text;
	expect(text).toMatch(/: PASS\./);
	expect(text).toContain(`Project: ${root}.`);
	expect(text).toContain("double_two: axioms none");
}, 600_000);

test("one time limit covers the build and the check, and a stopped build is incomplete", async () => {
	const root = project("slow-project");
	const home = fakeHome("slow-lake", { lake: "#!/bin/sh\ntrap '' TERM\nsleep 60\n" });
	const file = join(root, "Check.lean");
	const started = Date.now();
	const result = await withElan(home, () =>
		runLean({ file, source: readFileSync(file, "utf8"), build: true, timeLimit: 1 }),
	);
	expect(result.verdict).toBe("incomplete");
	expect(result.message).toBe("The time limit stopped `lake build`.");
	expect(Date.now() - started).toBeLessThan(20_000);
}, 300_000);

test("the skill's example proves the merge laws", async () => {
	const file = "skills/formal-verification/examples/merge.lean";
	const result = await runLean({ file, source: readFileSync(file, "utf8") });
	expect(result.verdict).toBe("pass");
	expect(result.theorems.map((theorem) => theorem.name).sort()).toEqual(["merge_assoc", "merge_comm", "merge_idem"]);
}, 300_000);
