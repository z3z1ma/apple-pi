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

test("runProcess always settles, leaves no killable process of its group, and reports a timeout only for unfinished work", async () => {
	const spec = resolve("specs/process-group.tla");
	const config = resolve("specs/process-group.cfg");
	const result = await runTlc({ spec, config });
	expect(result.verdict, result.output).toBe("pass");
	expect(result.unused).toEqual([]);
	const keptTimer = await runTlc({ spec, config, constants: { ClearTimerOnClose: "FALSE" } });
	expect(keptTimer).toMatchObject({ verdict: "violation", property: "TimedOutMeansUnfinished" });
	const waitedForClose = await runTlc({ spec, config, constants: { ReleasePipesAfterExit: "FALSE" } });
	expect(waitedForClose.verdict).toBe("violation");
	expect(waitedForClose.message).toMatch(/[Tt]emporal/);
}, 300_000);

async function proved(path: string) {
	const file = resolve(path);
	const result = await runLean({ file, source: readFileSync(file, "utf8") });
	expect(result.verdict, result.message).toBe("pass");
	return result.theorems.map((theorem) => theorem.name).sort();
}

test("lean_check's decision is proved sound for every possible run", async () => {
	expect(await proved("specs/lean-verdict.lean")).toEqual([
		"failed_replay_never_passes",
		"pass_sound",
		"resolve_theorem",
		"sorry_warning_never_passes",
		"summary_sound",
	]);
}, 300_000);

test("alloy_check's decision is proved sound for any list of commands", async () => {
	expect(await proved("specs/alloy-decision.lean")).toEqual(["execute_found", "pass_sound"]);
}, 300_000);

test("every declaration a passing Lean theorem depends on is replayed by the kernel or trusted by design", async () => {
	const result = await runAlloy({ spec: resolve("specs/lean-trust.als") });
	expect(result.verdict, result.message).toBe("pass");
	const before = result.commands.find((command) => command.name === "BeforeCoversEveryDependency");
	expect(before?.outcome).toBe("counterexample");
	expect(before?.instance).toMatch(/Elsewhere/);
}, 300_000);
