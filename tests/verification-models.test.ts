import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { runAlloy } from "../components/formal-verification/src/alloy.js";
import { runLean } from "../components/formal-verification/src/lean.js";
import { runTlc } from "../components/formal-verification/src/tlc.js";

test("elan publication by atomic rename never replaces a complete home", async () => {
	const result = await runTlc({
		spec: resolve("specs/elan-publication.tla"),
		config: resolve("specs/elan-publication.cfg"),
	});
	expect(result.verdict, result.output).toBe("pass");
	expect(result.unused).toEqual([]);
}, 120_000);

test("the earlier lock-file publication moves a complete home aside after a stale-lock race", async () => {
	const result = await runTlc({
		spec: resolve("specs/elan-publication-lock.tla"),
		config: resolve("specs/elan-publication-lock.cfg"),
	});
	expect(result.verdict).toBe("violation");
	expect(result.property).toBe("NoCompleteReplaced");
	expect(result.trace.some((state) => state.action === "RemoveStale")).toBe(true);
}, 120_000);

test("alloy_check's verdict passes only with every property proved, every expect met and a witness", async () => {
	const result = await runAlloy({ spec: resolve("specs/alloy-verdict.als") });
	expect(result.verdict, result.message).toBe("pass");
	expect(result.commands.find((command) => command.name === "EveryRunFindsAnInstance")?.outcome).toBe("counterexample");
}, 300_000);

test("lean_check's default verdict is proved sound in Lean", async () => {
	const file = resolve("specs/lean-verdict.lean");
	const result = await runLean({ file, source: readFileSync(file, "utf8") });
	expect(result.verdict, result.message).toBe("pass");
	expect(result.theorems.map((theorem) => theorem.name).sort()).toEqual([
		"pass_audits_a_written_theorem",
		"pass_has_no_sorry",
		"pass_has_only_standard_axioms",
		"sorry_warning_never_passes",
	]);
}, 300_000);
