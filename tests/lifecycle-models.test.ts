import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { runLean } from "../components/formal-verification/src/lean.js";
import { runTlc } from "../components/formal-verification/src/tlc.js";

for (const model of ["review-lifecycle", "departure-lifecycle"]) {
	test(`${model} exhausts its finite safety model`, async () => {
		const result = await runTlc({ spec: resolve(`specs/${model}.tla`), config: resolve(`specs/${model}.cfg`) });
		expect(result.verdict, result.output).toBe("pass");
		expect(result.stats?.left).toBe(0);
	}, 120_000);
}

test("a capability candidate reaches the main line only approved and with evidence for the version merged", async () => {
	const spec = resolve("specs/capability-candidate.tla");
	const config = resolve("specs/capability-candidate.cfg");
	const result = await runTlc({ spec, config });
	expect(result.verdict, result.output).toBe("pass");
	expect(result.unused).toEqual([]);
	const keptEvidence = await runTlc({ spec, config, constants: { KeepEvidenceOnRevise: "TRUE" } });
	expect(keptEvidence).toMatchObject({ verdict: "violation", property: "EvidenceForMerged" });
}, 120_000);

test("a program comparison leaves no worktree and starts no sample beside a live peer", async () => {
	const spec = resolve("specs/program-comparison.tla");
	const config = resolve("specs/program-comparison.cfg");
	const result = await runTlc({ spec, config });
	expect(result.verdict, result.output).toBe("pass");
	expect(result.unused).toEqual([]);
	const leakedDirectory = await runTlc({ spec, config, constants: { CleanupOnAddFailure: "FALSE" } });
	expect(leakedDirectory).toMatchObject({ verdict: "violation", property: "NothingLeftWhenSampleEnds" });
	const continuedPastClose = await runTlc({ spec, config, constants: { StopOnCloseFailure: "FALSE" } });
	expect(continuedPastClose).toMatchObject({ verdict: "violation", property: "RemoveOnlyAfterPeerCleanup" });
}, 120_000);

test("a program comparison gives both arms of every task the same runs, and replay never counts an unevaluated job", async () => {
	const file = resolve("specs/program-comparison.lean");
	const result = await runLean({ file, source: readFileSync(file, "utf8") });
	expect(result.verdict, result.message).toBe("pass");
	expect(result.theorems.map((theorem) => theorem.name)).toEqual(
		expect.arrayContaining(["schedule_count", "schedule_length", "replay_partition", "hits_are_evaluated"]),
	);
}, 300_000);

test("review staffing preserves the original workers through owned fork cleanup and crashes", async () => {
	const spec = resolve("specs/review-workers.tla");
	const config = resolve("specs/review-workers.cfg");
	const result = await runTlc({ spec, config });
	expect(result.verdict, result.output).toBe("pass");
	expect(result.unused).toEqual([]);
	const unsafe = await runTlc({ spec, config, constants: { UnsafeCleanup: "TRUE" } });
	expect(unsafe).toMatchObject({ verdict: "violation", property: "OriginalsPreserved" });
}, 120_000);

test("a review wait always ends, and needs both the silence watchdog and SIGKILL escalation to", async () => {
	const spec = resolve("specs/review-wait.tla");
	const config = resolve("specs/review-wait.cfg");
	const result = await runTlc({ spec, config });
	expect(result.verdict, result.output).toBe("pass");
	expect(result.unused).toEqual([]);
	for (const missing of ["WatchdogOn", "KillEscalation"]) {
		const without = await runTlc({ spec, config, constants: { [missing]: "FALSE" } });
		expect(without.verdict, missing).toBe("violation");
		expect(without.message).toMatch(/[Tt]emporal/);
	}
}, 300_000);
