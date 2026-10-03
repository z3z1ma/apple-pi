import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getShellConfig, loadSkills } from "@earendil-works/pi-coding-agent";
import { Monty, MontyTypingError } from "@pydantic/monty";
import { describe, expect, it } from "vitest";
import { guestPythonStubs } from "../components/pi-exec/src/guest-api.js";
import {
	EVIDENCE_FUNCTION_NAMES,
	evidencePythonStubs,
	runEvidenceFunction,
} from "../components/pi-exec/src/evidence.js";
import { PYTHON_SCHEMA_PRELUDE } from "../components/pi-exec/src/python-schema.js";

const PROGRAMS = ["plan-review-verify.py", "multi-lens-review.py", "residual-review-loop.py"];
const source = (name: string, skill = "code-review") => readFileSync(join("skills", skill, "references", name), "utf8");
function plain(value: any): any {
	if (value instanceof Map) return Object.fromEntries([...value].map(([key, item]) => [key, plain(item)]));
	if (Array.isArray(value)) return value.map(plain);
	if (value && typeof value === "object")
		return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, plain(item)]));
	return value;
}
type Host = (name: string, args: any) => Promise<any>;
/** Runs the actual packaged Python in Monty with live stubs and the public evidence dispatcher.
 * Model answers are deterministic fixtures; registered-tool routing belongs to runtime integration tests.
 */
async function run(
	name: string,
	inputs: Record<string, string>,
	host: Host,
	cwd = process.cwd(),
	skill = "code-review",
): Promise<any> {
	const pool = await Monty.create({ minProcesses: 0, maxProcesses: 1 });
	const live = guestPythonStubs();
	const stubs = live.includes("async def git_change(") ? live : `${live}\n${evidencePythonStubs()}`;
	const session = await pool.checkout({
		typeCheck: true,
		typeCheckStubs: stubs,
		limits: { maxSuspensions: 3000, maxTurnDurationSecs: 10, maxFeedDurationSecs: 30 },
	});
	try {
		await session.feedRun(PYTHON_SCHEMA_PRELUDE);
		return plain(
			await session.feedRun(source(name, skill), {
				inputs: { inputs, state: {} },
				externalLookup: {
					...Object.fromEntries(
						EVIDENCE_FUNCTION_NAMES.map((fn) => [
							fn,
							(args: any) => runEvidenceFunction(fn, plain(args ?? {}), { cwd }),
						]),
					),
					agent_run: (args: any) => host("agent_run", plain(args)),
					agent: async (args: any) => {
						const result = await host("agent_run", plain(args));
						if (result.status !== "completed") throw new Error(result.error);
						return result.value ?? result.text;
					},
					bash: (args: any) => host("bash", plain(args)),
					read: (args: any) => host("read", plain(args)),
				},
			}),
		);
	} catch (error) {
		if (error instanceof MontyTypingError) throw new Error(error.display());
		throw error;
	} finally {
		await session.close();
		await pool.close();
	}
}
function fixtureBash(command: string, cwd: string): string {
	const shell = getShellConfig();
	const stdin = shell.commandTransport === "stdin";
	return execFileSync(shell.shell, stdin ? shell.args : [...shell.args, command], {
		cwd,
		encoding: "utf8",
		...(stdin ? { input: command } : {}),
	});
}
function checkout(): string {
	const cwd = mkdtempSync(join(tmpdir(), "pi-review-python-"));
	const git = (...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });
	git("init", "-q");
	git("config", "user.email", "tests@example.invalid");
	git("config", "user.name", "Tests");
	writeFileSync(join(cwd, "feature.ts"), "export const safe = true;\n");
	git("add", ".");
	git("commit", "-qm", "initial");
	writeFileSync(join(cwd, "feature.ts"), "export const safe = false; // broken\n");
	return cwd;
}
const INPUTS = {
	paths: "feature.ts",
	compare: "HEAD",
	axes: "standards\nintent",
	axis: "standards",
	question: "Does the guard preserve the contract?",
	smellBaselinePath: "smells.md",
	standardsPaths: "AGENTS.md",
	intentPaths: "spec.md",
	lenses: "standards | Contracts | Is the guard intact?\nintent | Acceptance | Is the requested behavior reachable?",
};
function finding(axis: string): any {
	return {
		axis,
		title: "Disabled guard",
		severity: "significant",
		path: "feature.ts",
		startLine: 1,
		contract: `${axis === "intent" ? "spec.md" : "AGENTS.md"}:1 requires the guard`,
		trigger: "A guarded request",
		evidence: "feature.ts:1 sets safe=false",
		impact: "Request bypasses guard",
		recommendation: "Restore the guard",
	};
}
function verdict(candidates: any[]): any {
	return {
		decisions: candidates.map((item) => ({
			...item,
			status: "confirmed",
			priorDisposition: item.source === "prior" ? "open" : "not-applicable",
			loadBearing: true,
			reason: "Checked the changed guard",
		})),
		summary: "Evidence-backed defect",
		compoundRisks: [],
		residualRisks: [],
		coverageGaps: [],
	};
}
function fixtureHost(tweak?: (args: any, value: any) => any): Host {
	return async (name, args) => {
		if (name !== "agent_run") throw new Error(`Unexpected host call ${name}`);
		expect(args.tools).toEqual(["read", "grep", "find", "ls"]);
		expect(args.system_prompt).toContain("do not invoke code-review");
		let value: any;
		if (args.name === "review-planner") {
			value = {
				summary: "One cohesive partition",
				partitions: [
					{
						title: "Guard",
						files: ["feature.ts"],
						contextFiles: [],
						rationale: "One guard",
						focuses: ["standards", "intent"].map((axis) => ({
							axis,
							title: "Guard",
							priority: "high",
							question: "Does the guard work?",
							checks: ["Read guard"],
							rationale: "Protect contract",
						})),
					},
				],
			};
		} else if (args.context.focus) {
			expect(args.context.patch).toContain("+export const safe = false;");
			value = { findings: [finding(args.context.focus.axis)], notes: [] };
		} else {
			const candidates = args.context.candidates.length
				? args.context.candidates
				: (args.context.reductionEvidence ?? []).flatMap((item: any) => item.verdict.candidateReceipts);
			value = verdict(candidates);
		}
		return { status: "completed", value: tweak ? tweak(args, value) : value, text: "", toolCalls: 0 };
	};
}

describe("code-review Python programs", () => {
	it("loads only the renamed public skill", () => {
		const agentDir = mkdtempSync(join(tmpdir(), "apple-pi-code-review-"));
		try {
			const loaded = loadSkills({ cwd: process.cwd(), skillPaths: ["./skills"], includeDefaults: false, agentDir });
			expect(loaded.diagnostics).toEqual([]);
			expect(loaded.skills.map((skill) => skill.name)).toContain("code-review");
			expect(loaded.skills.map((skill) => skill.name)).not.toContain("review");
			expect(existsSync("skills/review")).toBe(false);
		} finally {
			rmSync(agentDir, { recursive: true, force: true });
		}
	});

	for (const program of PROGRAMS) {
		it(`${program} typechecks and returns evidence-backed findings on a real diff`, async () => {
			const cwd = checkout();
			try {
				const result = await run(program, INPUTS, fixtureHost(), cwd);
				expect(result.coverageComplete).toBe(true);
				expect(result.candidateReceipts.length).toBeGreaterThan(0);
				expect(result.meta.decisions[0]).toMatchObject({
					status: "confirmed",
					evidence: "feature.ts:1 sets safe=false",
				});
				expect(result.scope.changedFiles).toEqual(["feature.ts"]);
				expect(result.decisionReconciliation).toMatchObject({ unknownIds: [], missingIds: [], duplicateIds: [] });
				expect(existsSync(`skills/code-review/references/${program.replace(".py", ".js")}`)).toBe(false);
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	}

	it("fails incomplete path or axis coverage before dispatching reviewers", async () => {
		const cwd = checkout();
		let called = false;
		const host: Host = async () => {
			called = true;
			throw new Error("must not dispatch");
		};
		try {
			await expect(run("multi-lens-review.py", { ...INPUTS, paths: "missing.ts" }, host, cwd)).rejects.toThrow(
				"coverage failure",
			);
			await expect(run("multi-lens-review.py", { ...INPUTS, axes: "standards" }, host, cwd)).rejects.toThrow(
				"lens axis coverage mismatch",
			);
			expect(called).toBe(false);
			await expect(
				run(
					"plan-review-verify.py",
					INPUTS,
					fixtureHost((args, value) => {
						if (args.name === "review-planner") value.partitions[0].focuses = value.partitions[0].focuses.slice(0, 1);
						return value;
					}),
					cwd,
				),
			).rejects.toThrow("intent axis omitted");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects missing decision IDs, immutable-field changes, and cross-axis duplicate chains", async () => {
		const cwd = checkout();
		try {
			for (const corrupt of [
				(value: any) => {
					value.decisions = [];
				},
				(value: any) => {
					value.decisions[0].contract = "different contract";
				},
				(value: any) => {
					value.decisions[0].status = "duplicate";
					value.decisions[0].duplicateOf = "fresh-lens-2-1";
				},
			]) {
				await expect(
					run(
						"multi-lens-review.py",
						INPUTS,
						fixtureHost((args, value) => {
							if (!args.context.focus) corrupt(value);
							return value;
						}),
						cwd,
					),
				).rejects.toThrow();
			}
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("never presents failed lanes or clipped evidence as a complete clean review", async () => {
		const cwd = checkout();
		try {
			const successful = fixtureHost();
			const failed = await run(
				"multi-lens-review.py",
				INPUTS,
				async (name, args) =>
					args.name === "lens-1" ? { status: "failed", error: "fixture worker failed" } : successful(name, args),
				cwd,
			);
			expect(failed.coverageComplete).toBe(false);
			expect(failed.failedFocuses).toHaveLength(1);
			writeFileSync(
				join(cwd, "feature.ts"),
				`export const safe = false; // broken\n${"// long evidence\n".repeat(1500)}`,
			);
			const clipped = await run("multi-lens-review.py", INPUTS, fixtureHost(), cwd);
			expect(clipped.patchTruncated).toBe(true);
			expect(clipped.coverageComplete).toBe(false);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("submits every material residual gap in exactly one additional wave", async () => {
		const cwd = checkout();
		let residualCalls = 0;
		try {
			const result = await run(
				"residual-review-loop.py",
				INPUTS,
				fixtureHost((args, value) => {
					if (args.name === "coverage-triage")
						value.coverageGaps = ["Check guard A", "Check guard B", "Check guard C", "Check guard D"];
					if (args.name.startsWith("residual-")) residualCalls++;
					return value;
				}),
				cwd,
			);
			expect(residualCalls).toBe(4);
			expect(result.residualPasses).toBe(4);
			expect(result.candidateReceipts).toHaveLength(5);
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("preserves prior findings and fails rather than omitting oversized semantic evidence", async () => {
		const cwd = checkout();
		try {
			const prior = { ...finding("standards"), candidateId: "historical-guard", scope: "in-scope", loadBearing: true };
			const result = await run(
				"plan-review-verify.py",
				{ ...INPUTS, priorFindings: JSON.stringify([prior]) },
				fixtureHost(),
				cwd,
			);
			expect(result.candidateReceipts).toHaveLength(3);
			expect(result.meta.decisions.find((item: any) => item.candidateId === "historical-guard")).toMatchObject({
				priorDisposition: "open",
				source: "prior",
			});
			await expect(
				run(
					"multi-lens-review.py",
					INPUTS,
					fixtureHost((args, value) => {
						if (args.context.focus) value.findings[0].evidence = "evidence".repeat(2000);
						return value;
					}),
					cwd,
				),
			).rejects.toThrow("coverage failure: semantic group omitted candidates");
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("preserves the pragmatic review guardrails", () => {
		const text = readFileSync("skills/code-review/SKILL.md", "utf8");
		for (const phrase of [
			"work in progress",
			"review since X",
			"confirmation bias",
			"finding as a hypothesis",
			"attacker and defender",
			"must not invoke `code-review`",
			"stable shared-cause reference",
			"unranked shared-cause index",
			"without deduplicating, merging, or reranking",
		])
			expect(text.toLowerCase()).toContain(phrase.toLowerCase());
		for (const forbidden of [
			"shared causes / remediation order",
			"rank shared remediation groups",
			"shared remediation group",
		])
			expect(text.toLowerCase()).not.toContain(forbidden);
		for (const program of PROGRAMS)
			expect(source(program)).not.toMatch(/std\.|create_task|coverage_compare|reconcile_by_id/);
	});
});

describe("Ralph Python programs", () => {
	for (const program of ["ralph-simple.py", "ralph-ledger.py"]) {
		it(`${program} typechecks, sequences fresh workers, and stops on low mutation`, async () => {
			const cwd = checkout();
			let calls = 0;
			try {
				const result = await run(
					program,
					{
						goal: "One coherent increment",
						iterations: "4",
						task: ".ledger/task/task.md",
						stack: "README.md\n.ledger/task/task.md",
					},
					async (name, args) => {
						if (name === "read") return "Status: open\n";
						expect(name).toBe("agent_run");
						expect(args.profile).toBe("coding");
						expect(args.type).toBeUndefined();
						expect(args.output_schema).toBeUndefined();
						expect(args.system_prompt).toContain("Never commit");
						expect(args.tools).toEqual(["read", "grep", "find", "ls", "bash", "edit", "write"]);
						if (program === "ralph-ledger.py")
							expect(args.context.stack).toEqual([".ledger/task/task.md", "README.md"]);
						calls++;
						return { status: "completed", text: "increment done" };
					},
					cwd,
					"ralph",
				);
				expect(calls).toBe(2);
				expect(result).toMatchObject({
					status: "stopped",
					stopReason: "low-mutation",
					completedIterations: 2,
					requestedIterations: 4,
				});
			} finally {
				rmSync(cwd, { recursive: true, force: true });
			}
		});
	}
	it("counts changes to untracked content rather than treating a stable filename as no mutation", async () => {
		const cwd = checkout();
		let calls = 0;
		try {
			const path = join(cwd, "new ' file.txt");
			writeFileSync(path, "before");
			const result = await run(
				"ralph-simple.py",
				{ goal: "increment", iterations: "3" },
				async (name, args) => {
					if (name === "bash") return { ok: true, output: fixtureBash(args.command, cwd) };
					calls++;
					writeFileSync(path, `increment ${calls}`);
					return { status: "completed", text: "increment done" };
				},
				cwd,
				"ralph",
			);
			expect(result).toMatchObject({ status: "completed", completedIterations: 3 });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it("rejects noncanonical iteration bounds, preserves failure counts, and observes terminal ledger status", async () => {
		const cwd = checkout();
		const inputs = { goal: "increment", iterations: "4", stack: "README.md", task: ".ledger/task/task.md" };
		try {
			await expect(
				run(
					"ralph-simple.py",
					{ ...inputs, iterations: "04" },
					async () => {
						throw new Error("unexpected call");
					},
					cwd,
					"ralph",
				),
			).rejects.toThrow("canonical positive integer");
			const failed = await run(
				"ralph-simple.py",
				inputs,
				async () => ({ status: "failed", error: "worker failed" }),
				cwd,
				"ralph",
			);
			expect(failed).toMatchObject({
				status: "failed",
				completedIterations: 0,
				failedAt: 1,
				failures: [{ iteration: 1, error: "worker failed" }],
			});
			const stopped = await run(
				"ralph-ledger.py",
				inputs,
				async (name) => {
					expect(name).toBe("read");
					return "Status: blocked\n";
				},
				cwd,
				"ralph",
			);
			expect(stopped).toMatchObject({ status: "stopped", stopReason: "task-blocked", completedIterations: 0 });
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});
});
