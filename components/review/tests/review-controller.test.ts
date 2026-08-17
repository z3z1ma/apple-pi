import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import type { ManagedAgentRequest, ManagedSubagentService } from "../../subagents/src/service.js";
import type { AgentRecord } from "../../subagents/src/types.js";
import { type ResolvedReviewModel, ReviewController } from "../src/controller.js";
import { previewReviewInput } from "../src/git.js";

const roots: string[] = [];
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

afterEach(() => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function repository(): string {
	const root = mkdtempSync(join(tmpdir(), "apple-review-controller-"));
	roots.push(root);
	execFileSync("git", ["init", "-q", root]);
	execFileSync("git", ["-C", root, "config", "user.email", "review@example.test"]);
	execFileSync("git", ["-C", root, "config", "user.name", "Review Test"]);
	mkdirSync(join(root, "src"));
	mkdirSync(join(root, "docs"));
	writeFileSync(join(root, "src", "value.ts"), "export const value = 1;\n");
	writeFileSync(join(root, "src", "value.test.ts"), "expect(value).toBe(1);\n");
	writeFileSync(join(root, "docs", "value.md"), "Value is one.\n");
	execFileSync("git", ["-C", root, "add", "."]);
	execFileSync("git", ["-C", root, "commit", "-qm", "baseline"]);
	writeFileSync(join(root, "src", "value.ts"), "export const value = 2;\n");
	writeFileSync(join(root, "src", "value.test.ts"), "expect(value).toBe(2);\n");
	writeFileSync(join(root, "docs", "value.md"), "Value is two.\n");
	const agentDir = mkdtempSync(join(tmpdir(), "apple-review-agent-"));
	roots.push(agentDir);
	process.env.PI_CODING_AGENT_DIR = agentDir;
	return root;
}

function context(cwd: string) {
	const model = { provider: "test", id: "caller", reasoning: true } as Model<any>;
	return {
		cwd,
		model,
		modelRegistry: { find: () => model },
		thinkingLevel: "high",
		isProjectTrusted: () => true,
	} as any;
}

async function invoke(request: ManagedAgentRequest, name: string, params: unknown): Promise<void> {
	const tool = request.customTools?.find((entry) => entry.name === name);
	if (!tool) throw new Error(`missing tool ${name}`);
	await tool.execute("test-result", params as never, undefined, undefined, {} as never);
}

function record(request: ManagedAgentRequest, sequence: number): AgentRecord {
	return {
		id: `agent-${sequence}`,
		type: request.type,
		description: request.description,
		status: "completed",
		result: "ok",
		toolUses: 1,
		startedAt: Date.now() - 20,
		completedAt: Date.now(),
		lifetimeUsage: { input: 100, output: 50, cacheWrite: 0 },
		compactionCount: 0,
	};
}

function modelRoute(calls: Array<{ mode: string; tier: string }>) {
	return async (_ctx: any, mode: string, tier: "fast" | "strong"): Promise<ResolvedReviewModel> => {
		calls.push({ mode, tier });
		return {
			model: { provider: "test", id: mode, reasoning: true } as Model<any>,
			thinkingLevel: tier === "strong" ? "xhigh" : "high",
			mode,
			tier,
		};
	};
}

describe("ReviewController", () => {
	it("opens partitions, reviews them in parallel, verifies once, and keeps same-line findings distinct", async () => {
		const root = repository();
		const items = previewReviewInput(root, { mode: "workspace" }).reviewable;
		const requests: ManagedAgentRequest[] = [];
		let sequence = 0;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				requests.push(request);
				request.onStarted?.(`agent-${++sequence}`);
				if (request.type === "review-planner") {
					await invoke(request, "open_review", {
						title: "Value contract",
						files: ["src/value.ts", "src/value.test.ts"],
						focuses: [
							{
								title: "Export",
								question: "Can the export break callers?",
								checks: ["Trace consumers."],
							},
						],
					});
					await invoke(request, "open_review", {
						title: "Docs",
						files: ["docs/value.md"],
						focuses: [{ title: "Docs", question: "Do the docs agree?", checks: ["Compare stated value."] }],
					});
					return record(request, sequence);
				}
				if (request.type === "reviewer") {
					if (request.prompt.includes("Focus: c1-p1-f1")) {
						await invoke(request, "report", {
							kind: "finding",
							severity: "significant",
							path: "src/value.ts",
							startLine: 1,
							endLine: 1,
							side: "new",
							what: "Exported value changed",
							why: "Callers may take the wrong branch.",
							evidence: "export const value = 2;",
						});
						await invoke(request, "report", {
							kind: "finding",
							severity: "minor",
							path: "src/value.ts",
							startLine: 1,
							endLine: 1,
							side: "new",
							what: "No compatibility comment",
							why: "A caller cannot tell the change is intentional.",
							evidence: "export const value = 2;",
						});
					} else {
						await invoke(request, "report", {
							kind: "note",
							what: "Documentation agrees.",
							evidence: "Value is two.",
						});
					}
					return record(request, sequence);
				}
				const block = request.prompt.split("<candidate-findings>")[1]?.split("</candidate-findings>")[0] ?? "[]";
				const findingIds = (JSON.parse(block) as Array<{ id: string }>).map((finding) => finding.id);
				await invoke(request, "submit_meta_review", {
					decisions: findingIds.map((findingId) => ({
						findingId,
						status: "confirmed",
						reason: "The changed export is observable.",
						evidence: "The exact changed line exports the new value.",
					})),
					sentiment: "The value contract changed; documentation kept up.",
					compoundRisks: [],
					residuals: [],
					coverageGaps: [],
				});
				return record(request, sequence);
			},
			abort: () => true,
		};
		const routes: Array<{ mode: string; tier: string }> = [];
		const run = await new ReviewController({ getService: () => service, resolveModel: modelRoute(routes) }).run(
			context(root),
			{ mode: "workspace" },
			{ root, profile: "fast", background: "Changing the public value contract." },
		);
		expect(run.state).toBe("complete");
		expect(run.completedItemIds).toHaveLength(3);
		expect(run.failures).toEqual([]);
		expect(run.workGraph?.cycles).toHaveLength(1);
		expect(run.workGraph?.cycles[0].focuses.map((focus) => focus.id)).toEqual(["c1-p1-f1", "c1-p2-f1"]);
		expect(run.findings).toHaveLength(2);
		expect(run.findings.map((finding) => finding.summary).sort()).toEqual([
			"Exported value changed",
			"No compatibility comment",
		]);
		expect(run.notes).toHaveLength(1);
		expect(run.metaReviews?.[0].sentiment).toContain("value contract");
		expect(requests.find((request) => request.type === "review-planner")?.prompt).toContain("id: src/value.ts");
		expect(requests.find((request) => request.type === "review-planner")?.prompt).not.toMatch(/id: [a-f0-9]{64}/);
		expect(requests.filter((request) => request.type === "review-planner")).toHaveLength(1);
		expect(requests.filter((request) => request.type === "review-verifier")).toHaveLength(1);
		expect(run.findings.every((finding) => finding.anchorProvenance === "exact_file")).toBe(true);
		expect(run.findings.every((finding) => finding.evidence.includes("1| export const value = 2;"))).toBe(true);
		expect(requests.find((request) => request.type === "review-verifier")?.prompt).toContain("<finding-clusters>");
		expect(requests.find((request) => request.type === "review-verifier")?.prompt).toContain(
			"1| export const value = 2;",
		);
		expect(routes.some((route) => route.mode === "review-rigorous" && route.tier === "strong")).toBe(true);
		expect(requests.find((request) => request.type === "review-verifier")?.model.id).toBe("review-rigorous");
		expect(
			requests
				.filter((request) => request.type === "reviewer")
				.every((request) => request.model.id === "review-routine"),
		).toBe(true);
		expect(requests.every((request) => request.maxTurns === 0)).toBe(true);
		expect(items).toHaveLength(3);
	});

	it("marks a selected file incomplete when the planner never opens it", async () => {
		const root = repository();
		let sequence = 0;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.(`agent-${++sequence}`);
				if (request.type === "review-planner") {
					await invoke(request, "open_review", {
						files: ["src/value.ts"],
						focuses: [{ title: "Export", question: "Is the export safe?", checks: ["Read the export."] }],
					});
					return record(request, sequence);
				}
				if (request.type === "reviewer") return record(request, sequence);
				await invoke(request, "submit_meta_review", {
					decisions: [],
					sentiment: "Only the export was reviewed.",
					residuals: [],
					coverageGaps: ["tests and docs were skipped"],
					compoundRisks: [],
				});
				return record(request, sequence);
			},
			abort: () => true,
		};
		const run = await new ReviewController({ getService: () => service, resolveModel: modelRoute([]) }).run(
			context(root),
			{ mode: "workspace" },
			{ root, profile: "fast" },
		);
		expect(run.state).toBe("partial");
		expect(run.completedItemIds).toHaveLength(1);
		expect(run.failures.some((failure) => failure.path === "docs/value.md")).toBe(true);
		expect(run.failures.some((failure) => failure.classification === "planner")).toBe(true);
	});

	it("runs a second thorough cycle from verifier residuals", async () => {
		const root = repository();
		let planners = 0;
		let sequence = 0;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.(`agent-${++sequence}`);
				if (request.type === "review-planner") {
					planners++;
					if (planners === 1) {
						await invoke(request, "open_review", {
							files: ["src/value.ts", "src/value.test.ts", "docs/value.md"],
							focuses: [{ title: "First look", question: "Does the value change hold?", checks: ["Read the export."] }],
						});
					} else {
						expect(request.prompt).toContain("<prior-meta-review>");
						await invoke(request, "open_review", {
							files: ["src/value.ts"],
							focuses: [
								{
									title: "Callers",
									question: "Did any caller of the old sentinel get missed?",
									checks: ["Search for the old value."],
								},
							],
						});
					}
					return record(request, sequence);
				}
				if (request.type === "reviewer") return record(request, sequence);
				await invoke(request, "submit_meta_review", {
					decisions: [],
					sentiment: planners === 1 ? "Need a caller pass." : "Caller pass found nothing new.",
					residuals: planners === 1 ? ["Check remaining callers of the old value."] : [],
					coverageGaps: [],
					compoundRisks: [],
				});
				return record(request, sequence);
			},
			abort: () => true,
		};
		const run = await new ReviewController({ getService: () => service, resolveModel: modelRoute([]) }).run(
			context(root),
			{ mode: "workspace" },
			{ root, profile: "thorough" },
		);
		expect(run.state).toBe("complete");
		expect(planners).toBe(2);
		expect(run.workGraph?.cycles).toHaveLength(2);
		expect(run.budgets.maxCycles).toBe(3);
	});

	it("keeps a file complete when a sibling focus fails", async () => {
		const root = repository();
		let sequence = 0;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.(`agent-${++sequence}`);
				if (request.type === "review-planner") {
					await invoke(request, "open_review", {
						files: ["src/value.ts"],
						focuses: [
							{ title: "Export", question: "Is the export safe?", checks: ["Read the export."] },
							{ title: "Callers", question: "Did callers break?", checks: ["Search callers."] },
						],
					});
					return record(request, sequence);
				}
				if (request.type === "reviewer") {
					if (request.prompt.includes("Focus: c1-p1-f2")) throw new Error("sibling reviewer crashed");
					return record(request, sequence);
				}
				await invoke(request, "submit_meta_review", {
					decisions: [],
					sentiment: "One focus failed; the file was still covered.",
					residuals: [],
					coverageGaps: [],
					compoundRisks: [],
				});
				return record(request, sequence);
			},
			abort: () => true,
		};
		const run = await new ReviewController({ getService: () => service, resolveModel: modelRoute([]) }).run(
			context(root),
			{ mode: "workspace" },
			{ root, profile: "fast" },
		);
		const valueId = run.selected.find((item) => item.path === "src/value.ts")?.id;
		expect(run.state).toBe("partial");
		expect(valueId).toBeDefined();
		expect(run.completedItemIds).toContain(valueId);
		expect(run.failures.some((failure) => failure.path === "src/value.ts")).toBe(false);
		expect(run.failures.some((failure) => failure.classification === "planner")).toBe(true);
	});

	it("does not un-complete a first pass when a later-cycle focus fails", async () => {
		const root = repository();
		let planners = 0;
		let sequence = 0;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.(`agent-${++sequence}`);
				if (request.type === "review-planner") {
					planners++;
					await invoke(request, "open_review", {
						files: planners === 1 ? ["src/value.ts", "src/value.test.ts", "docs/value.md"] : ["src/value.ts"],
						focuses: [
							{
								title: planners === 1 ? "First look" : "Callers",
								question: planners === 1 ? "Does the value change hold?" : "Did any caller get missed?",
								checks: ["Read the export."],
							},
						],
					});
					return record(request, sequence);
				}
				if (request.type === "reviewer") {
					if (planners > 1) throw new Error("residual reviewer crashed");
					return record(request, sequence);
				}
				await invoke(request, "submit_meta_review", {
					decisions: [],
					sentiment: planners === 1 ? "Need a caller pass." : "Should not be required after a crash.",
					residuals: planners === 1 ? ["Check remaining callers of the old value."] : [],
					coverageGaps: [],
					compoundRisks: [],
				});
				return record(request, sequence);
			},
			abort: () => true,
		};
		const controller = new ReviewController({ getService: () => service, resolveModel: modelRoute([]) });
		const run = await controller.run(context(root), { mode: "workspace" }, { root, profile: "thorough" });
		expect(run.state).toBe("complete");
		expect(run.completedItemIds).toHaveLength(3);
		expect(run.failures).toHaveLength(0);
		expect(run.residualRisk.some((risk) => /failed after coverage already held/.test(risk))).toBe(true);
		expect(controller.status(root, run.runId)).toMatchObject({ runId: run.runId, state: "complete" });
	});

	it("accounts every selected file when the verifier throws after successful reviews", async () => {
		const root = repository();
		let sequence = 0;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.(`agent-${++sequence}`);
				if (request.type === "review-planner") {
					await invoke(request, "open_review", {
						files: ["src/value.ts"],
						focuses: [{ title: "Export", question: "Is the export safe?", checks: ["Read the export."] }],
					});
					return record(request, sequence);
				}
				if (request.type === "reviewer") return record(request, sequence);
				throw new Error("verifier boom");
			},
			abort: () => true,
		};
		const controller = new ReviewController({ getService: () => service, resolveModel: modelRoute([]) });
		const run = await controller.run(context(root), { mode: "workspace" }, { root, profile: "fast" });
		expect(run.state).toBe("partial");
		expect(run.completedItemIds).toHaveLength(1);
		expect(run.failures).toHaveLength(2);
		expect(run.failures.every((failure) => failure.classification === "planner")).toBe(true);
		expect(controller.status(root, run.runId)).toMatchObject({ runId: run.runId, state: "partial" });
	});

	it("does not publish complete when first-cycle verification misses after full coverage", async () => {
		const root = repository();
		let sequence = 0;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.(`agent-${++sequence}`);
				if (request.type === "review-planner") {
					await invoke(request, "open_review", {
						files: ["src/value.ts", "src/value.test.ts", "docs/value.md"],
						focuses: [{ title: "Export", question: "Is the export safe?", checks: ["Read the export."] }],
					});
					return record(request, sequence);
				}
				if (request.type === "reviewer") return record(request, sequence);
				throw new Error("verifier boom");
			},
			abort: () => true,
		};
		const run = await new ReviewController({ getService: () => service, resolveModel: modelRoute([]) }).run(
			context(root),
			{ mode: "workspace" },
			{ root, profile: "fast" },
		);
		expect(run.state).toBe("error");
		expect(run.completedItemIds).toHaveLength(3);
		expect(run.failures).toHaveLength(0);
		expect(run.metaReviews ?? []).toHaveLength(0);
		expect(run.terminalCause).toBe("internal_error");
	});

	it("stops on operator stop, caller cancel, and workspace mutation", async () => {
		const stopRoot = repository();
		const cancelRoot = repository();
		const conflictRoot = repository();
		const abort = new AbortController();
		const stopController = new ReviewController({
			getService: () => ({
				async runFresh(_ctx, request) {
					request.onStarted?.("agent-stop");
					if (request.type === "review-planner") {
						await invoke(request, "open_review", {
							files: ["src/value.ts", "src/value.test.ts", "docs/value.md"],
							focuses: [{ title: "Export", question: "Is the export safe?", checks: ["Read the export."] }],
						});
						return record(request, 1);
					}
					if (request.type === "reviewer") return record(request, 2);
					const listed = stopController.status(stopRoot);
					const live = Array.isArray(listed) ? listed[0] : listed;
					void stopController.stop(stopRoot, live.runId);
					return { ...record(request, 3), status: "aborted" };
				},
				abort: () => true,
			}),
			resolveModel: modelRoute([]),
		});
		const stopped = await stopController.run(
			context(stopRoot),
			{ mode: "workspace" },
			{ root: stopRoot, profile: "fast" },
		);
		expect(stopped.state).toBe("stopped");
		expect(stopped.terminalCause).toBe("operator_stop");

		const cancelled = await new ReviewController({
			getService: () => ({
				async runFresh(_ctx, request) {
					request.onStarted?.("agent-cancel");
					if (request.type === "review-planner") {
						await invoke(request, "open_review", {
							files: ["src/value.ts", "src/value.test.ts", "docs/value.md"],
							focuses: [{ title: "Export", question: "Is the export safe?", checks: ["Read the export."] }],
						});
						return record(request, 1);
					}
					if (request.type === "reviewer") return record(request, 2);
					abort.abort();
					return { ...record(request, 3), status: "aborted" };
				},
				abort: () => true,
			}),
			resolveModel: modelRoute([]),
		}).run(context(cancelRoot), { mode: "workspace" }, { root: cancelRoot, profile: "fast" }, abort.signal);
		expect(cancelled.state).toBe("stopped");
		expect(cancelled.terminalCause).toBe("external_cancellation");

		const conflicted = await new ReviewController({
			getService: () => ({
				async runFresh(_ctx, request) {
					request.onStarted?.("agent-conflict");
					if (request.type === "review-planner") {
						await invoke(request, "open_review", {
							files: ["src/value.ts", "src/value.test.ts", "docs/value.md"],
							focuses: [{ title: "Export", question: "Is the export safe?", checks: ["Read the export."] }],
						});
						return record(request, 1);
					}
					if (request.type === "reviewer") return record(request, 2);
					writeFileSync(join(conflictRoot, "src", "value.ts"), "export const value = 99;\n");
					await invoke(request, "submit_meta_review", {
						decisions: [],
						sentiment: "Workspace moved under the verifier.",
						residuals: [],
						coverageGaps: [],
						compoundRisks: [],
					});
					return record(request, 3);
				},
				abort: () => true,
			}),
			resolveModel: modelRoute([]),
		}).run(context(conflictRoot), { mode: "workspace" }, { root: conflictRoot, profile: "fast" });
		expect(conflicted.state).toBe("workspace_conflict");
		expect(conflicted.terminalCause).toBe("workspace_conflict");
	});

	it("turns invited false positives into clarity residuals for later cycles", async () => {
		const root = repository();
		let planners = 0;
		let sequence = 0;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.(`agent-${++sequence}`);
				if (request.type === "review-planner") {
					planners++;
					if (planners > 1) expect(request.prompt).toContain("Clarity: src/value.ts:");
					await invoke(request, "open_review", {
						files: planners === 1 ? ["src/value.ts", "src/value.test.ts", "docs/value.md"] : ["src/value.ts"],
						focuses: [
							{
								title: planners === 1 ? "Export" : "Document the invariant",
								question: planners === 1 ? "Is the export safe?" : "Did the last reject leave the rule unstated?",
								checks: ["Read the export."],
							},
						],
					});
					return record(request, sequence);
				}
				if (request.type === "reviewer") {
					if (planners === 1) {
						await invoke(request, "report", {
							kind: "finding",
							severity: "significant",
							path: "src/value.ts",
							startLine: 1,
							endLine: 1,
							what: "Mid-cycle reseal is missing",
							why: "A mutation after planning can be read for the rest of the cycle.",
						});
					}
					return record(request, sequence);
				}
				const block = request.prompt.split("<candidate-findings>")[1]?.split("</candidate-findings>")[0] ?? "[]";
				const findingIds = (JSON.parse(block) as Array<{ id: string }>).map((finding) => finding.id);
				await invoke(request, "submit_meta_review", {
					decisions: findingIds.map((findingId) => ({
						findingId,
						status: "rejected",
						reason: "Reseal is cycle-start plus post-drain, not mid-cycle.",
						evidence: "assertReviewInputUnchanged runs at those two points.",
						invitedByAmbiguity: true,
					})),
					sentiment: planners === 1 ? "One invited false positive." : "Clarity follow-up done.",
					residuals: [],
					coverageGaps: [],
					compoundRisks: [],
				});
				return record(request, sequence);
			},
			abort: () => true,
		};
		const run = await new ReviewController({ getService: () => service, resolveModel: modelRoute([]) }).run(
			context(root),
			{ mode: "workspace" },
			{ root, profile: "thorough" },
		);
		expect(planners).toBeGreaterThan(1);
		expect(run.findings).toHaveLength(1);
		expect(run.findings[0].validation).toMatchObject({
			status: "rejected",
			invitedByAmbiguity: true,
		});
		expect(run.metaReviews?.[0].residuals.some((residual) => residual.startsWith("Clarity: src/value.ts:"))).toBe(true);
		expect(run.residualRisk.some((risk) => /Clarity: src\/value\.ts:/.test(risk))).toBe(true);
	});

	it("reviews only caller-scoped paths", async () => {
		const root = repository();
		let sequence = 0;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.(`agent-${++sequence}`);
				if (request.type === "review-planner") {
					expect(request.prompt).toContain("src/value.ts");
					expect(request.prompt).not.toContain("docs/value.md");
					await invoke(request, "open_review", {
						files: ["src/value.ts", "src/value.test.ts"],
						focuses: [{ title: "Export", question: "Is the export safe?", checks: ["Read the export."] }],
					});
					return record(request, sequence);
				}
				if (request.type === "reviewer") return record(request, sequence);
				await invoke(request, "submit_meta_review", {
					decisions: [],
					sentiment: "Scoped review covered src only.",
					residuals: [],
					coverageGaps: [],
					compoundRisks: [],
				});
				return record(request, sequence);
			},
			abort: () => true,
		};
		const run = await new ReviewController({ getService: () => service, resolveModel: modelRoute([]) }).run(
			context(root),
			{ mode: "workspace" },
			{ root, profile: "fast", paths: ["src"] },
		);
		expect(run.state).toBe("complete");
		expect(run.selected.map((item) => item.path).sort()).toEqual(["src/value.test.ts", "src/value.ts"]);
		expect(run.selected.some((item) => item.path.startsWith("docs/"))).toBe(false);
	});

	it("runs same-file focuses in parallel and keeps ledger history out of coverage", async () => {
		const root = repository();
		mkdirSync(join(root, ".ledger"));
		writeFileSync(join(root, ".ledger", "task.md"), "# shaping history\n");
		const events: Array<{ focus: string; at: "start" | "end"; time: number }> = [];
		let sequence = 0;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.(`agent-${++sequence}`);
				if (request.type === "review-planner") {
					expect(request.prompt).not.toContain("id: .ledger/task.md");
					await invoke(request, "open_review", {
						files: ["src/value.ts"],
						focuses: [
							{ title: "Export", question: "Is the export safe?", checks: ["Read the export."] },
							{ title: "Callers", question: "Did callers break?", checks: ["Search callers."] },
						],
					});
					return record(request, sequence);
				}
				if (request.type === "reviewer") {
					const focus = /Focus: (\S+)/.exec(request.prompt)?.[1] ?? "unknown";
					events.push({ focus, at: "start", time: Date.now() });
					await new Promise((resolve) => setTimeout(resolve, 30));
					events.push({ focus, at: "end", time: Date.now() });
					return record(request, sequence);
				}
				await invoke(request, "submit_meta_review", {
					decisions: [],
					sentiment: "Same-file focuses ran together.",
					residuals: [],
					coverageGaps: [],
					compoundRisks: [],
				});
				return record(request, sequence);
			},
			abort: () => true,
		};
		const run = await new ReviewController({ getService: () => service, resolveModel: modelRoute([]) }).run(
			context(root),
			{ mode: "workspace" },
			{ root, profile: "fast" },
		);
		const starts = events.filter((event) => event.at === "start");
		const firstEnd = events.find((event) => event.at === "end");
		expect(run.waived.some((entry) => entry.path === ".ledger/task.md")).toBe(true);
		expect(run.selected.some((item) => item.path === ".ledger/task.md")).toBe(false);
		expect(starts).toHaveLength(2);
		expect(firstEnd).toBeDefined();
		expect(starts[1].time).toBeLessThan(firstEnd!.time);
	});
});
