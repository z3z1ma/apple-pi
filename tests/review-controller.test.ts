import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { ReviewController, type ResolvedReviewModel } from "../components/review/src/controller.js";
import { previewReviewInput, reviewRepositoryRoot } from "../components/review/src/git.js";
import { loadReviewRun, readReviewReceiptEvents, reviewReceiptPath } from "../components/review/src/receipts.js";
import type { ReviewRun } from "../components/review/src/types.js";
import type { ManagedAgentRequest, ManagedSubagentService } from "../components/subagents/src/service.js";
import type { AgentRecord } from "../components/subagents/src/types.js";

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

function record(request: ManagedAgentRequest, result: unknown, sequence: number, submit = true): AgentRecord {
	const output = request.customTools?.[0];
	if (submit && output) void output.execute("test-result", result as never, undefined, undefined, {} as never);
	return {
		id: `agent-${sequence}`,
		type: request.type,
		description: request.description,
		status: "completed",
		result: JSON.stringify(result),
		toolUses: 2,
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
	it("plans semantic groups, reviews them in parallel, routes models, verifies findings, and closes complete", async () => {
		const root = repository();
		const items = previewReviewInput(root, { mode: "workspace" }).reviewable;
		const byPath = new Map(items.map((item) => [item.path, item.id]));
		const requests: ManagedAgentRequest[] = [];
		let sequence = 0;
		let runningReviewers = 0;
		let peakReviewers = 0;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				requests.push(request);
				request.onStarted?.(`agent-${sequence + 1}`);
				sequence++;
				expect(request.model?.id).toMatch(/^review-/);
				if (request.type === "review-planner") {
					return record(
						request,
						{
							summary: "Implementation and test share a contract; documentation is independent.",
							groups: [
								{
									id: "value-contract",
									title: "Value contract",
									objective: "Trace the changed exported value into its test consumer.",
									itemIds: [byPath.get("src/value.ts"), byPath.get("src/value.test.ts")],
									contextPaths: [],
									tier: "strong",
									rationale: "The test directly consumes the changed value contract.",
								},
								{
									id: "value-doc",
									title: "Value documentation",
									objective: "Check that the documentation agrees with the new value.",
									itemIds: [byPath.get("docs/value.md")],
									contextPaths: ["src/value.ts"],
									tier: "fast",
									rationale: "This is a small documentation synchronization change.",
								},
							],
						},
						sequence,
					);
				}
				if (request.type === "reviewer") {
					runningReviewers++;
					peakReviewers = Math.max(peakReviewers, runningReviewers);
					await new Promise((resolve) => setTimeout(resolve, 15));
					runningReviewers--;
					if (request.prompt.includes("Group: value-contract")) {
						return record(
							request,
							{
								summary: "The changed implementation and test agree, but the exported contract may break callers.",
								reviewedItemIds: [byPath.get("src/value.ts"), byPath.get("src/value.test.ts")],
								findings: [
									{
										severity: "significant",
										category: "bug",
										summary: "Preserve callers expecting the old exported value",
										impact: "Existing consumers receive a changed sentinel and take the wrong branch.",
										evidence: "The patch changes the exported value from 1 to 2.",
										path: "src/value.ts",
										anchor: "export const value = 2;",
										side: "new",
									},
								],
								residualRisk: [],
							},
							sequence,
						);
					}
					return record(
						request,
						{
							summary: "Documentation agrees with the change.",
							reviewedItemIds: [byPath.get("docs/value.md")],
							findings: [],
							residualRisk: [],
						},
						sequence,
					);
				}
				if (request.type === "review-verifier") {
					const findingId = request.prompt.match(/"id": "([a-f0-9]+)"/)?.[1];
					return record(
						request,
						{
							decisions: [
								{
									findingId,
									status: "confirmed",
									reason: "The changed export is observable outside the module.",
									evidence: "The exact changed line exports the new value.",
								},
							],
							residualRisk: [],
						},
						sequence,
					);
				}
				throw new Error(`unexpected role ${request.type}`);
			},
			abort: () => true,
		};
		const routes: Array<{ mode: string; tier: string }> = [];
		const controller = new ReviewController({ getService: () => service, resolveModel: modelRoute(routes) });
		const run = await controller.run(
			context(tmpdir()),
			{ mode: "workspace" },
			{ root, profile: "balanced", background: "Changing the public value contract." },
		);
		expect(run.state).toBe("complete");
		expect(run.completedItemIds).toHaveLength(3);
		expect(run.failures).toEqual([]);
		expect(run.workGraph?.groups.map((group) => [group.id, group.tier])).toEqual([
			["value-contract", "strong"],
			["value-doc", "fast"],
		]);
		expect(peakReviewers).toBe(2);
		expect(run.findings).toHaveLength(1);
		expect(run.findings[0]).toMatchObject({
			path: "src/value.ts",
			startLine: 1,
			endLine: 1,
			anchorProvenance: "exact_hunk",
			validation: { status: "confirmed" },
		});
		expect(routes).toEqual([
			{ mode: "review-planner", tier: "fast" },
			{ mode: "review-strong", tier: "strong" },
			{ mode: "review-fast", tier: "fast" },
			{ mode: "review-strong", tier: "strong" },
		]);
		expect(run.totalTokens).toBe(600);
		expect(requests.every((request) => request.agentConfig.builtinToolNames?.join(",") === "read,grep,find,ls")).toBe(
			true,
		);
		expect(run.projectRoot).toBe(reviewRepositoryRoot(root));
		expect(requests.every((request) => request.cwd === run.projectRoot)).toBe(true);
		expect(requests.every((request) => request.toolPolicy)).toBe(true);
		const receipts = readReviewReceiptEvents(root, run.runId);
		expect(receipts.at(-1)?.state).toBe("complete");
		expect((controller.status(join(root, "src"), run.runId) as ReviewRun).state).toBe("complete");
		expect(run.policy?.envelopes).toHaveLength(4);
		expect(receipts.some((event) => event.outcome === "role_policy_resolved")).toBe(true);
		expect(receipts[0].run.selected.every((item) => !("diff" in item))).toBe(true);
		// Additive policy/cause fields leave pre-policy schema-v1 review receipts readable.
		const path = reviewReceiptPath(root, run.runId);
		writeFileSync(
			path,
			readFileSync(path, "utf8")
				.split(/\n/)
				.filter(Boolean)
				.map((line) => {
					const event = JSON.parse(line);
					delete event.run.policy;
					delete event.run.terminalCause;
					return JSON.stringify(event);
				})
				.join("\n") + "\n",
		);
		expect(loadReviewRun(root, run.runId).state).toBe("complete");
	});

	it("aborts managed review work at the live aggregate token ceiling", async () => {
		const root = repository();
		let aborted = false;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.("budget-agent");
				request.onAssistantUsage?.({ input: 59_000, output: 1_000, cacheWrite: 0 });
				return {
					...record(request, {}, 1),
					status: "stopped",
					result: "",
					lifetimeUsage: { input: 59_000, output: 1_000, cacheWrite: 0 },
				};
			},
			abort: () => {
				aborted = true;
				return true;
			},
		};
		const controller = new ReviewController({ getService: () => service, resolveModel: modelRoute([]) });
		const run = await controller.run(context(root), { mode: "workspace" }, { constraints: { maxTokens: 60_000 } });
		expect(aborted).toBe(true);
		expect(run.state).toBe("failed");
		expect(run.lastOutcome).toMatch(/token ceiling reached/i);
		expect(run.terminalCause).toBe("aggregate_token_ceiling");
	});

	it("waits for active review agents to quiesce before returning an operator stop", async () => {
		const root = repository();
		let request: ManagedAgentRequest | undefined;
		let release: (() => void) | undefined;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, next) {
				request = next;
				next.onStarted?.("active-planner");
				await new Promise<void>((resolve) => {
					release = resolve;
				});
				return {
					...record(next, {}, 1),
					status: "stopped",
					result: "",
				};
			},
			abort: (agentId) => {
				expect(agentId).toBe("active-planner");
				release?.();
				return true;
			},
		};
		const controller = new ReviewController({ getService: () => service, resolveModel: modelRoute([]) });
		const running = controller.run(context(root), { mode: "workspace" });
		for (let attempt = 0; attempt < 50 && !request; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
		const summary = controller.status(root) as Array<{ runId: string }>;
		expect(summary).toHaveLength(1);
		const otherController = new ReviewController({ getService: () => service, resolveModel: modelRoute([]) });
		await expect(otherController.run(context(root), { mode: "workspace" })).rejects.toThrow(
			/already owns this project/,
		);
		await expect(otherController.stop(root, summary[0].runId)).rejects.toThrow(/owning Pi session/);
		const stopped = await controller.stop(root, summary[0].runId);
		const final = await running;
		expect(stopped.state).toBe("stopped");
		expect(stopped.terminalCause).toBe("operator_stop");
		expect(final.state).toBe("stopped");
		expect(readReviewReceiptEvents(root, final.runId).at(-1)?.state).toBe("stopped");
	});

	it("does not launch an agent when stopped during model resolution", async () => {
		const root = repository();
		let releaseRoute: (() => void) | undefined;
		let serviceCalls = 0;
		const service: ManagedSubagentService = {
			async runFresh() {
				serviceCalls++;
				throw new Error("agent must not launch after cancellation");
			},
			abort: () => true,
		};
		const controller = new ReviewController({
			getService: () => service,
			resolveModel: async (_ctx, mode, tier) => {
				await new Promise<void>((resolve) => {
					releaseRoute = resolve;
				});
				return { model: { provider: "test", id: mode } as Model<any>, thinkingLevel: "high", mode, tier };
			},
		});
		const running = controller.run(context(root), { mode: "workspace" });
		let runId: string | undefined;
		for (let attempt = 0; attempt < 50 && !runId; attempt++) {
			await new Promise((resolve) => setTimeout(resolve, 5));
			runId = (controller.status(root) as Array<{ runId: string }>)[0]?.runId;
		}
		expect(runId).toBeTruthy();
		const stopping = controller.stop(root, runId!);
		releaseRoute?.();
		const [stopped, final] = await Promise.all([stopping, running]);
		expect(stopped.state).toBe("stopped");
		expect(final.state).toBe("stopped");
		expect(serviceCalls).toBe(0);
	});

	it("fails closed when the planner omits a selected item", async () => {
		const root = repository();
		const items = previewReviewInput(root, { mode: "workspace" }).reviewable;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.("planner");
				return record(
					request,
					{
						summary: "Incomplete partition.",
						groups: [
							{
								id: "partial",
								title: "Partial",
								objective: "Review one file.",
								itemIds: [items[0].id],
								contextPaths: [],
								tier: "fast",
								rationale: "Incomplete on purpose for the test.",
							},
						],
					},
					1,
				);
			},
			abort: () => true,
		};
		const controller = new ReviewController({ getService: () => service, resolveModel: modelRoute([]) });
		const run = await controller.run(context(root), { mode: "workspace" });
		expect(run.state).toBe("failed");
		expect(run.completedItemIds).toEqual([]);
		expect(run.failures).toHaveLength(3);
		expect(run.failures.every((failure) => failure.classification === "planner")).toBe(true);
		expect(run.lastOutcome).toMatch(/omitted review items/);
	});

	it("retains candidates but marks coverage incomplete when verification fails", async () => {
		const root = repository();
		const items = previewReviewInput(root, { mode: "workspace" }).reviewable;
		let sequence = 0;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.(`agent-${++sequence}`);
				if (request.type === "review-planner")
					return record(
						request,
						{
							summary: "One semantic group.",
							groups: [
								{
									id: "all",
									title: "All",
									objective: "Review all changed behavior.",
									itemIds: items.map((item) => item.id),
									contextPaths: [],
									tier: "fast",
									rationale: "Small cohesive change.",
								},
							],
						},
						sequence,
					);
				if (request.type === "reviewer")
					return record(
						request,
						{
							summary: "Candidate found.",
							reviewedItemIds: items.map((item) => item.id),
							findings: [
								{
									severity: "minor",
									category: "bug",
									summary: "Check changed value",
									impact: "Consumer behavior may change.",
									evidence: "Export changed.",
									path: "src/value.ts",
									anchor: "export const value = 2;",
									side: "new",
								},
							],
							residualRisk: [],
						},
						sequence,
					);
				return record(request, { decisions: [], residualRisk: [] }, sequence);
			},
			abort: () => true,
		};
		const controller = new ReviewController({ getService: () => service, resolveModel: modelRoute([]) });
		const run = await controller.run(context(root), { mode: "workspace" });
		expect(run.state).toBe("failed");
		expect(run.completedItemIds).toEqual([]);
		expect(run.failures).toHaveLength(3);
		expect(run.findings[0].validation).toMatchObject({
			status: "retained_unresolved",
			reason: "Verification did not complete",
		});
	});

	it("fails closed when a role omits its typed result submission", async () => {
		const root = repository();
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.("planner");
				return record(request, {}, 1, false);
			},
			abort: () => true,
		};
		const controller = new ReviewController({ getService: () => service, resolveModel: modelRoute([]) });
		const run = await controller.run(context(root), { mode: "workspace" });
		expect(run.state).toBe("failed");
		expect(run.lastOutcome).toMatch(/did not submit exactly one typed result/);
		expect(run.terminalCause).toBe("invalid_output");
	});

	it("records explicit provider, turn, compaction, and authority causes", async () => {
		const cases = [
			{ name: "provider", record: { status: "error", error: "provider unavailable" }, cause: "provider_error" },
			{ name: "turn", record: { status: "aborted", terminationCause: "turn_ceiling" }, cause: "role_turn_ceiling" },
			{
				name: "compaction",
				record: { status: "aborted", terminationCause: "compaction", compactionCount: 1 },
				cause: "compaction",
			},
		] as const;
		for (const testCase of cases) {
			const root = repository();
			const service: ManagedSubagentService = {
				async runFresh(_ctx, request) {
					request.onStarted?.(testCase.name);
					return { ...record(request, {}, 1, false), ...testCase.record } as AgentRecord;
				},
				abort: () => true,
			};
			const run = await new ReviewController({ getService: () => service, resolveModel: modelRoute([]) }).run(
				context(root),
				{ mode: "workspace" },
			);
			expect(run.terminalCause, testCase.name).toBe(testCase.cause);
		}
		const root = repository();
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				await request.toolPolicy?.({ toolName: "read", args: { path: "/tmp/outside" } }, new AbortController().signal);
				return record(request, {}, 1, false);
			},
			abort: () => true,
		};
		const run = await new ReviewController({ getService: () => service, resolveModel: modelRoute([]) }).run(
			context(root),
			{ mode: "workspace" },
		);
		expect(run.terminalCause).toBe("authority_denial");
	});

	it("records external cancellation before a role launches", async () => {
		const root = repository();
		const abort = new AbortController();
		abort.abort();
		const service: ManagedSubagentService = {
			async runFresh() {
				throw new Error("must not launch");
			},
			abort: () => true,
		};
		const run = await new ReviewController({ getService: () => service, resolveModel: modelRoute([]) }).run(
			context(root),
			{ mode: "workspace" },
			{},
			abort.signal,
		);
		expect(run.state).toBe("stopped");
		expect(run.terminalCause).toBe("external_cancellation");
	});

	it("records elapsed-time and workspace-conflict causes", async () => {
		const timeoutRoot = repository();
		const timeoutService: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.("timeout");
				await new Promise<void>((resolve) =>
					request.signal?.addEventListener("abort", () => resolve(), { once: true }),
				);
				return { ...record(request, {}, 1, false), status: "stopped" } as AgentRecord;
			},
			abort: () => true,
		};
		const timedOut = await new ReviewController({ getService: () => timeoutService, resolveModel: modelRoute([]) }).run(
			context(timeoutRoot),
			{ mode: "workspace" },
			{ constraints: { timeoutSeconds: 2 } },
		);
		expect(timedOut.terminalCause).toBe("elapsed_time_ceiling");

		const workspaceRoot = repository();
		const items = previewReviewInput(workspaceRoot, { mode: "workspace" }).reviewable;
		const workspaceService: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.("planner");
				writeFileSync(join(workspaceRoot, "src", "value.ts"), "export const value = 3;\n");
				return record(
					request,
					{
						summary: "One group.",
						groups: [
							{
								id: "all",
								title: "All",
								objective: "Review all.",
								itemIds: items.map((item) => item.id),
								contextPaths: [],
								tier: "fast",
								rationale: "Small change.",
							},
						],
					},
					1,
				);
			},
			abort: () => true,
		};
		const conflicted = await new ReviewController({
			getService: () => workspaceService,
			resolveModel: modelRoute([]),
		}).run(context(workspaceRoot), { mode: "workspace" });
		expect(conflicted.state).toBe("workspace_conflict");
		expect(conflicted.terminalCause).toBe("workspace_conflict");
	});

	it("fails closed when a role submits its typed result more than once", async () => {
		const root = repository();
		const items = previewReviewInput(root, { mode: "workspace" }).reviewable;
		const service: ManagedSubagentService = {
			async runFresh(_ctx, request) {
				request.onStarted?.("planner");
				const output = request.customTools?.[0];
				const value = {
					summary: "One group.",
					groups: [
						{
							id: "all",
							title: "All",
							objective: "Review all items.",
							itemIds: items.map((item) => item.id),
							tier: "fast",
							rationale: "One change.",
						},
					],
				};
				if (output) {
					void output.execute("first", value as never, undefined, undefined, {} as never);
					void output.execute("second", value as never, undefined, undefined, {} as never);
				}
				return record(request, value, 1, false);
			},
			abort: () => true,
		};
		const controller = new ReviewController({ getService: () => service, resolveModel: modelRoute([]) });
		const run = await controller.run(context(root), { mode: "workspace" });
		expect(run.state).toBe("failed");
		expect(run.lastOutcome).toMatch(/did not submit exactly one typed result/);
	});
});
