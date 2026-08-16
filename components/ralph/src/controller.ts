import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getManagedSubagentService, type ManagedSubagentService } from "../../subagents/src/service.js";
import { getLifetimeTotal } from "../../subagents/src/usage.js";
import { ReviewController, summarizeReviewRun } from "../../review/src/controller.js";
import type { ReviewRun } from "../../review/src/types.js";
import { createExecutorAuthorityPolicy, type AuthorityDenial } from "./authority-policy.js";
import { acquireRalphRunLeases } from "./lease.js";
import { appendReceipt, listRunSummaries, loadRun, receiptPath } from "./receipts.js";
import { resolveRalphRoots } from "./roots.js";
import {
	executorPrompt,
	judgePrompt,
	createRalphResultTool,
	parseExecutorOutput,
	parseJudgeOutput,
	roleProfile,
} from "./roles.js";
import {
	activateTask,
	appendIndependentReview,
	appendJudgment,
	appendRunJournal,
	blockTask,
	closeTask,
	completeTaskWorkItemsUnderLease,
	recordExecutorOutcome,
} from "./task.js";
import type {
	JudgeOutput,
	RalphAgentRole,
	WorkItemCompletionProposal,
	WorkItemJudgment,
	RalphBudgets,
	RalphMode,
	RalphRole,
	RalphRun,
	RalphState,
	RalphTerminalCause,
	RalphTerminalState,
	ReviewerOutput,
	RunSummary,
} from "./types.js";
import {
	compileWorkGraph,
	hasDistillation,
	hasRetrospective,
	missingCriterionEvidence,
	WorkGraphError,
} from "./work-graph.js";
import {
	assertCleanWorkspace,
	assertWorkspaceMatches,
	captureWorkspace,
	changedPaths,
	renderWorkspaceChanges,
	WorkspaceError,
} from "./workspace.js";

export const DEFAULT_RALPH_BUDGETS: RalphBudgets = {
	maxIterations: 10,
	maxTokens: 1_000_000,
	timeoutSeconds: 7_200,
	executorMaxTurns: 80,
	reviewerMaxTurns: 30,
	judgeMaxTurns: 20,
};

const TERMINAL_STATES = new Set<RalphState>([
	"done",
	"blocked",
	"review_failed",
	"evidence_failed",
	"workspace_conflict",
	"authority_required",
	"budget_exhausted",
	"compacted",
	"interrupted",
	"stopped",
	"error",
]);

export interface StartRunOptions {
	mode?: RalphMode;
	budgets?: Partial<RalphBudgets>;
	root?: string;
	ledgerRoot?: string;
}

export interface RalphControllerDependencies {
	getService?: () => ManagedSubagentService | undefined;
	reviewController?: Pick<ReviewController, "run">;
}

interface ActiveRunControl {
	abort: AbortController;
	agentId?: string;
	projectRoot: string;
	stopRequested: boolean;
	externalCancelled: boolean;
	forcedGate?: { state: RalphTerminalState; reason: string; cause: RalphTerminalCause };
	settled?: Promise<void>;
	resolveSettled?: () => void;
}

export class RalphController {
	private readonly active = new Map<string, ActiveRunControl>();
	private readonly getService: () => ManagedSubagentService | undefined;
	private readonly reviewController: Pick<ReviewController, "run">;

	constructor(dependencies: RalphControllerDependencies = {}) {
		this.getService = dependencies.getService ?? getManagedSubagentService;
		this.reviewController = dependencies.reviewController ?? new ReviewController({ getService: this.getService });
	}

	async start(ctx: ExtensionContext, taskPath: string, options: StartRunOptions = {}): Promise<RalphRun> {
		this.assertExecutionContext(ctx);
		const mode = options.mode ?? "step";
		if (mode !== "step" && mode !== "auto") throw new Error(`Invalid Ralph mode: ${String(mode)}`);
		const roots = resolveRalphRoots(ctx.cwd, options.root, options.ledgerRoot);
		const preflight = compileWorkGraph(roots.workspaceRoot, taskPath, {}, roots.ledgerRoot);
		const budgets = normalizeBudgets(options.budgets, deriveRalphBudgets(mode, preflight));
		const runId = randomUUID();
		const releaseLeases = acquireRalphRunLeases(roots.workspaceRoot, roots.ledgerRoot, preflight.task.path, runId);
		try {
			assertCleanWorkspace(roots.workspaceRoot);
			const baselineWorkspace = captureWorkspace(roots.workspaceRoot);
			let graph = compileWorkGraph(roots.workspaceRoot, preflight.task.path, {}, roots.ledgerRoot);
			if (graph.task.status === "open") {
				await activateTask(graph.task.absolutePath, graph.task.digest);
				graph = compileWorkGraph(roots.workspaceRoot, graph.task.path, {}, roots.ledgerRoot);
			}
			const expectedWorkspace = captureWorkspace(roots.workspaceRoot);
			const now = new Date().toISOString();
			const run: RalphRun = {
				schemaVersion: 2,
				runId,
				projectRoot: graph.projectRoot,
				ledgerRoot: graph.ledgerRoot,
				taskPath: graph.task.path,
				mode,
				state: "ready",
				iteration: 0,
				budgets,
				policy: { version: 1, mode, recordCount: graph.records.length, contextBytes: graph.byteLength, budgets },
				startedAt: now,
				updatedAt: now,
				graphHash: graph.graphHash,
				baselineWorkspace,
				expectedWorkspace,
				totalTokens: 0,
			};
			await appendReceipt(run, {
				outcome: "run_started",
				graphHash: graph.graphHash,
				workspaceHashAfter: expectedWorkspace.hash,
			});
			return run;
		} finally {
			releaseLeases();
		}
	}

	async step(ctx: ExtensionContext, runId: string, signal?: AbortSignal, root?: string): Promise<RalphRun> {
		return this.continue(ctx, runId, 1, signal, root);
	}

	async run(
		ctx: ExtensionContext,
		taskPath: string,
		options: StartRunOptions = {},
		signal?: AbortSignal,
	): Promise<RalphRun> {
		const run = await this.start(ctx, taskPath, { ...options, mode: "auto" });
		return this.continue(ctx, run.runId, run.budgets.maxIterations, signal, run.projectRoot);
	}

	async continue(
		ctx: ExtensionContext,
		runId: string,
		maxIterations: number,
		signal?: AbortSignal,
		root?: string,
	): Promise<RalphRun> {
		this.assertExecutionContext(ctx);
		if (this.active.has(runId)) throw new Error(`Ralph run is already active: ${runId}`);
		const workspaceRoot = resolveRalphRoots(ctx.cwd, root).workspaceRoot;
		let run = loadRun(workspaceRoot, runId);
		if (run.projectRoot !== workspaceRoot) throw new Error(`Ralph run belongs to ${run.projectRoot}`);
		resolveRalphRoots(ctx.cwd, run.projectRoot, run.ledgerRoot);
		for (const [activeId, control] of this.active) {
			if (control.projectRoot === run.projectRoot) throw new Error(`Ralph run ${activeId} already owns this workspace`);
		}
		if (TERMINAL_STATES.has(run.state)) return run;
		const releaseLeases = acquireRalphRunLeases(run.projectRoot, run.ledgerRoot, run.taskPath, run.runId);
		try {
			run = loadRun(workspaceRoot, runId);
		} catch (error) {
			releaseLeases();
			throw error;
		}
		if (TERMINAL_STATES.has(run.state)) {
			releaseLeases();
			return run;
		}
		if (["executing", "reviewing", "judging"].includes(run.state)) {
			try {
				run = await this.gate(
					run,
					"interrupted",
					"A prior process ended during an agent stage; Ralph never resumes that context",
				);
				return run;
			} finally {
				releaseLeases();
			}
		}
		try {
			assertWorkspaceMatches(run.expectedWorkspace, captureWorkspace(run.projectRoot));
		} catch (error) {
			try {
				return await this.handleFailure(run, error);
			} finally {
				releaseLeases();
			}
		}
		let resolveSettled: (() => void) | undefined;
		const settled = new Promise<void>((resolve) => {
			resolveSettled = resolve;
		});
		const control: ActiveRunControl = {
			abort: new AbortController(),
			agentId: undefined,
			projectRoot: run.projectRoot,
			stopRequested: false,
			externalCancelled: false,
			settled,
			resolveSettled,
		};
		this.active.set(runId, control);
		const onExternalAbort = () => {
			control.externalCancelled = true;
			control.abort.abort();
		};
		signal?.addEventListener("abort", onExternalAbort, { once: true });
		if (signal?.aborted) {
			control.externalCancelled = true;
			control.abort.abort();
		}
		try {
			for (let count = 0; count < maxIterations; count++) {
				if (run.iteration >= run.budgets.maxIterations) {
					return await this.gate(
						run,
						"budget_exhausted",
						`Maximum iterations reached: ${run.budgets.maxIterations}`,
						"iteration_ceiling",
					);
				}
				if (this.elapsedSeconds(run) >= run.budgets.timeoutSeconds || run.totalTokens >= run.budgets.maxTokens) {
					return await this.gate(
						run,
						"budget_exhausted",
						"Run time or token budget exhausted before the next iteration",
						this.elapsedSeconds(run) >= run.budgets.timeoutSeconds ? "elapsed_time_ceiling" : "aggregate_token_ceiling",
					);
				}
				run.iteration++;
				run.updatedAt = new Date().toISOString();
				run = await this.runIteration(ctx, run, control);
				if (run.state !== "iterating") return run;
				if (run.mode === "step") return run;
			}
			return run.state === "iterating"
				? await this.gate(
						run,
						"budget_exhausted",
						`Invocation iteration limit reached: ${maxIterations}`,
						"iteration_ceiling",
					)
				: run;
		} catch (error) {
			return await this.handleFailure(run, error);
		} finally {
			signal?.removeEventListener("abort", onExternalAbort);
			control.resolveSettled?.();
			this.active.delete(runId);
			releaseLeases();
		}
	}

	status(projectRoot: string, runId?: string): RalphRun | RunSummary[] {
		return runId ? loadRun(projectRoot, runId) : listRunSummaries(projectRoot);
	}

	async stop(projectRoot: string, runId: string): Promise<RalphRun> {
		projectRoot = realpathSync(projectRoot);
		const control = this.active.get(runId);
		if (control) {
			if (control.projectRoot !== projectRoot) throw new Error(`Ralph run ${runId} belongs to ${control.projectRoot}`);
			control.stopRequested = true;
			control.abort.abort();
			if (control.agentId) this.getService()?.abort(control.agentId);
			await control.settled;
			const settled = loadRun(projectRoot, runId);
			if (TERMINAL_STATES.has(settled.state)) return settled;
			return this.gate(settled, "stopped", "Stopped by the operator");
		}
		const discovered = loadRun(projectRoot, runId);
		if (TERMINAL_STATES.has(discovered.state)) return discovered;
		const releaseLeases = acquireRalphRunLeases(
			discovered.projectRoot,
			discovered.ledgerRoot,
			discovered.taskPath,
			`stop-${runId}-${process.pid}`,
		);
		try {
			const run = loadRun(projectRoot, runId);
			if (TERMINAL_STATES.has(run.state)) return run;
			return await this.gate(run, "stopped", "Stopped by the operator");
		} finally {
			releaseLeases();
		}
	}

	async stopAll(): Promise<void> {
		const controls = [...this.active.values()];
		for (const control of controls) {
			control.stopRequested = true;
			control.abort.abort();
			if (control.agentId) this.getService()?.abort(control.agentId);
		}
		await Promise.all(controls.map((control) => control.settled));
	}

	private async runIteration(ctx: ExtensionContext, run: RalphRun, control: ActiveRunControl): Promise<RalphRun> {
		let graph = compileWorkGraph(run.projectRoot, run.taskPath, {}, run.ledgerRoot);
		this.assertGraphUnchanged(run, graph.graphHash);
		assertWorkspaceMatches(run.expectedWorkspace, captureWorkspace(run.projectRoot));
		const beforeExecutor = run.expectedWorkspace;

		run.state = "executing";
		run.updatedAt = new Date().toISOString();
		const executorProfile = roleProfile("executor");
		await appendReceipt(run, {
			stage: "executor",
			outcome: "stage_started",
			graphHash: graph.graphHash,
			roleSkillHash: executorProfile.skillHash,
			workspaceHashBefore: run.expectedWorkspace.hash,
		});
		const denials: AuthorityDenial[] = [];
		const executorStageAbort = new AbortController();
		const executorRole = await this.runRole(
			ctx,
			run,
			control,
			"executor",
			executorPrompt(graph, run.iteration, run.nextObjective),
			executorProfile,
			createExecutorAuthorityPolicy(
				run.projectRoot,
				(denial) => {
					denials.push(denial);
					executorStageAbort.abort();
				},
				run.ledgerRoot,
			),
			executorStageAbort.signal,
		);
		run = await this.accountAgent(
			run,
			"executor",
			executorRole.record,
			executorProfile.skillHash,
			control,
			denials.length > 0,
		);
		const afterExecutorTools = captureWorkspace(run.projectRoot);
		run.expectedWorkspace = afterExecutorTools;
		if (denials.length > 0)
			return this.gate(run, "authority_required", denials.map((denial) => denial.reason).join("; "));
		const semanticChanges = changedPaths(beforeExecutor, afterExecutorTools).filter(
			(change) => change.path === ".ledger" || change.path.startsWith(".ledger/"),
		);
		if (semanticChanges.length > 0) {
			return this.gate(
				run,
				"authority_required",
				`Executor changed semantic authority directly: ${semanticChanges.map((change) => change.path).join(", ")}`,
			);
		}
		this.assertGraphUnchanged(run, compileWorkGraph(run.projectRoot, run.taskPath, {}, run.ledgerRoot).graphHash);
		if (executorRole.submissionCount !== 1 || executorRole.output === undefined) {
			throw new RalphGateError("error", "Ralph executor did not submit exactly one typed result", "invalid_output");
		}
		const executor = parseExecutorOutput(executorRole.output);
		const workItemProposals = validateWorkItemProposals(graph, executor.workItemCompletions);
		await recordExecutorOutcome(graph.task.absolutePath, graph.task.digest, run.runId, run.iteration, executor);
		const afterExecutor = captureWorkspace(run.projectRoot);
		run.expectedWorkspace = afterExecutor;
		if (executor.status === "blocked") {
			await appendReceipt(run, {
				stage: "executor",
				outcome: executor.status,
				structuredOutput: executor,
				workItems: { proposals: workItemProposals },
				workspaceHashAfter: afterExecutor.hash,
			});
			return this.gate(run, "blocked", executor.blockers.join("; ") || executor.summary);
		}
		graph = compileWorkGraph(run.projectRoot, run.taskPath, {}, run.ledgerRoot);
		run.graphHash = graph.graphHash;
		await appendReceipt(run, {
			stage: "executor",
			outcome: executor.status,
			structuredOutput: executor,
			workItems: { proposals: workItemProposals },
			workspaceHashAfter: afterExecutor.hash,
		});
		if (executor.status === "failed") return this.gate(run, "error", executor.summary);
		run.state = "reviewing";
		run.updatedAt = new Date().toISOString();
		await appendReceipt(run, {
			stage: "reviewer",
			outcome: "stage_started",
			graphHash: graph.graphHash,
			workspaceHashBefore: afterExecutor.hash,
		});
		const remainingSeconds = Math.max(1, run.budgets.timeoutSeconds - this.elapsedSeconds(run));
		const remainingReviewTokens = run.budgets.maxTokens - run.totalTokens;
		if (remainingReviewTokens < 10_000)
			return this.gate(
				run,
				"budget_exhausted",
				`Fewer than 10,000 tokens remain for independent review: ${remainingReviewTokens}`,
				"aggregate_token_ceiling",
			);
		const reviewTimeout = AbortSignal.timeout(remainingSeconds * 1000);
		const reviewSignal = AbortSignal.any([control.abort.signal, reviewTimeout]);
		const reviewRun = await this.reviewController.run(
			ctx,
			{ mode: "workspace" },
			{
				root: run.projectRoot,
				profile: "balanced",
				background: `Ralph iteration ${run.iteration} executor report:\n${JSON.stringify(executor, null, 2)}`,
				authorityPacket: graph.bundle,
				// Parent safety capacity is controller-owned; Ralph never exposes or forwards caller arithmetic.
				constraints: {
					maxTokens: remainingReviewTokens,
					timeoutSeconds: Math.max(1, Math.ceil(remainingSeconds)),
				},
			},
			reviewSignal,
		);
		run.totalTokens += reviewRun.totalTokens;
		if (control.stopRequested)
			throw new RalphGateError("stopped", "Stopped by the operator during independent review", "operator_stop");
		if (control.externalCancelled)
			throw new RalphGateError(
				"interrupted",
				"Independent review was cancelled by the caller",
				"external_cancellation",
			);
		if (reviewTimeout.aborted || reviewRun.terminalCause === "elapsed_time_ceiling") {
			throw new RalphGateError(
				"budget_exhausted",
				"Independent review reached Ralph's elapsed-time ceiling",
				"elapsed_time_ceiling",
			);
		}
		if (reviewRun.terminalCause === "external_cancellation") {
			throw new RalphGateError("interrupted", "Independent review was interrupted", "external_cancellation");
		}
		if (run.totalTokens >= run.budgets.maxTokens)
			return this.gate(
				run,
				"budget_exhausted",
				`Token budget reached: ${run.totalTokens}/${run.budgets.maxTokens}`,
				"aggregate_token_ceiling",
			);
		const afterReviewer = captureWorkspace(run.projectRoot);
		assertWorkspaceMatches(afterExecutor, afterReviewer);
		const review = ralphReviewOutput(reviewRun);
		await appendReceipt(run, {
			stage: "reviewer",
			outcome: review.verdict,
			structuredOutput: { reviewRunId: reviewRun.runId, review },
			workspaceHashAfter: afterReviewer.hash,
		});
		if (reviewRun.state !== "complete" && reviewRun.state !== "skipped") {
			return this.gate(run, "review_failed", `Shared review did not complete: ${summarizeReviewRun(reviewRun)}`);
		}
		this.assertGraphUnchanged(run, compileWorkGraph(run.projectRoot, run.taskPath, {}, run.ledgerRoot).graphHash);
		await appendIndependentReview(graph.task.absolutePath, graph.task.digest, run.runId, run.iteration, review);
		run.expectedWorkspace = captureWorkspace(run.projectRoot);
		graph = compileWorkGraph(run.projectRoot, run.taskPath, {}, run.ledgerRoot);
		run.graphHash = graph.graphHash;
		const judgedChanges = renderWorkspaceChanges(run.projectRoot, run.baselineWorkspace, run.expectedWorkspace);

		run.state = "judging";
		run.updatedAt = new Date().toISOString();
		const judgeProfileValue = roleProfile("judge");
		await appendReceipt(run, {
			stage: "judge",
			outcome: "stage_started",
			graphHash: graph.graphHash,
			roleSkillHash: judgeProfileValue.skillHash,
			workspaceHashBefore: run.expectedWorkspace.hash,
		});
		const beforeJudge = run.expectedWorkspace;
		const judgeDenials: AuthorityDenial[] = [];
		const judgeStageAbort = new AbortController();
		const judgeRole = await this.runRole(
			ctx,
			run,
			control,
			"judge",
			judgePrompt(graph, judgedChanges.text, executor, review),
			judgeProfileValue,
			createExecutorAuthorityPolicy(
				run.projectRoot,
				(denial) => {
					judgeDenials.push(denial);
					judgeStageAbort.abort();
				},
				run.ledgerRoot,
			),
			judgeStageAbort.signal,
		);
		run = await this.accountAgent(
			run,
			"judge",
			judgeRole.record,
			judgeProfileValue.skillHash,
			control,
			judgeDenials.length > 0,
		);
		if (judgeDenials.length > 0)
			return this.gate(run, "authority_required", judgeDenials.map((denial) => denial.reason).join("; "));
		const afterJudge = captureWorkspace(run.projectRoot);
		assertWorkspaceMatches(beforeJudge, afterJudge);
		if (judgeRole.submissionCount !== 1 || judgeRole.output === undefined) {
			throw new RalphGateError("error", "Ralph judge did not submit exactly one typed result", "invalid_output");
		}
		const judgment = parseJudgeOutput(judgeRole.output);
		const workItemJudgments = validateWorkItemJudgments(workItemProposals, judgment.workItemJudgments);
		await appendReceipt(run, {
			stage: "judge",
			outcome: judgment.decision,
			structuredOutput: judgment,
			workItems: { judgments: workItemJudgments },
			workspaceHashAfter: afterJudge.hash,
		});
		this.assertGraphUnchanged(run, compileWorkGraph(run.projectRoot, run.taskPath, {}, run.ledgerRoot).graphHash);
		const judgmentMutation = await appendJudgment(
			graph.task.absolutePath,
			graph.task.digest,
			run.runId,
			run.iteration,
			judgment,
		);
		graph = compileWorkGraph(run.projectRoot, run.taskPath, {}, run.ledgerRoot);
		if (graph.task.digest !== judgmentMutation.digest) {
			throw new WorkGraphError("Ledger authority changed after judgment", "semantic_authority_changed");
		}
		const confirmedWorkItems = workItemJudgments.filter((item) => item.decision === "confirmed").map((item) => item.id);
		const rejectedWorkItems = workItemJudgments.filter((item) => item.decision === "rejected");
		const rejectedSummary =
			rejectedWorkItems.length === 0
				? undefined
				: `Rejected work items: ${rejectedWorkItems.map((item) => `${item.id} (${item.reason})`).join(", ")}`;
		if (confirmedWorkItems.length > 0)
			await completeTaskWorkItemsUnderLease(graph.task.absolutePath, graph.task.digest, run.runId, confirmedWorkItems);
		run.expectedWorkspace = captureWorkspace(run.projectRoot);
		graph = compileWorkGraph(run.projectRoot, run.taskPath, {}, run.ledgerRoot);
		run.graphHash = graph.graphHash;
		await appendReceipt(run, {
			stage: "judge",
			outcome: "work_items_applied",
			workItems: {
				confirmedIds: confirmedWorkItems,
				rejectedIds: rejectedWorkItems.map((item) => item.id),
				taskDigest: graph.task.digest,
			},
			workspaceHashAfter: run.expectedWorkspace.hash,
		});

		if (judgment.decision === "close") return this.closeIfSupported(run, graph, review, judgment);
		if (judgment.decision === "blocked") {
			const reason = [judgment.reason, rejectedSummary].filter(Boolean).join("; ");
			await blockTask(graph.task.absolutePath, graph.task.digest, reason);
			run.expectedWorkspace = captureWorkspace(run.projectRoot);
			return this.gate(run, "blocked", reason);
		}
		if (judgment.decision === "stop")
			return this.gate(run, "stopped", [judgment.reason, rejectedSummary].filter(Boolean).join("; "), "judge_stop");

		run.state = "iterating";
		run.nextObjective = [judgment.nextObjective, rejectedSummary].filter(Boolean).join("; ");
		run.lastOutcome = judgment.reason;
		run.updatedAt = new Date().toISOString();
		await appendRunJournal(
			graph.task.absolutePath,
			graph.task.digest,
			run.runId,
			run.iteration,
			`Judgment requested another fresh iteration: ${judgment.reason}`,
		);
		run.expectedWorkspace = captureWorkspace(run.projectRoot);
		graph = compileWorkGraph(run.projectRoot, run.taskPath, {}, run.ledgerRoot);
		run.graphHash = graph.graphHash;
		await appendReceipt(run, {
			outcome: "iteration_complete",
			structuredOutput: judgment,
			workspaceHashAfter: run.expectedWorkspace.hash,
		});
		return run;
	}

	private async runRole(
		ctx: ExtensionContext,
		run: RalphRun,
		control: ActiveRunControl,
		role: RalphAgentRole,
		prompt: string,
		profile: ReturnType<typeof roleProfile>,
		toolPolicy?: ReturnType<typeof createExecutorAuthorityPolicy>,
		stageAbort?: AbortSignal,
	) {
		const service = this.getService();
		if (!service) throw new Error("Ralph requires apple-pi's subagent extension to be loaded first");
		if (control.stopRequested || control.abort.signal.aborted)
			throw new RalphGateError(
				control.stopRequested ? "stopped" : "interrupted",
				"Run was cancelled before the next fresh role",
				control.stopRequested
					? "operator_stop"
					: control.externalCancelled
						? "external_cancellation"
						: "internal_error",
			);
		if (run.totalTokens >= run.budgets.maxTokens)
			throw new RalphGateError(
				"budget_exhausted",
				"No token budget remains for the next fresh role",
				"aggregate_token_ceiling",
			);
		const remainingMs = Math.max(1, run.budgets.timeoutSeconds * 1000 - (Date.now() - Date.parse(run.startedAt)));
		const timeout = AbortSignal.timeout(remainingMs);
		const signals = [control.abort.signal, timeout, ...(stageAbort ? [stageAbort] : [])];
		const signal = AbortSignal.any(signals);
		const maxTurns = role === "executor" ? run.budgets.executorMaxTurns : run.budgets.judgeMaxTurns;
		const resultTool = createRalphResultTool(role);
		let liveTokens = 0;
		const record = await service.runFresh(ctx, {
			type: `ralph-${role}`,
			description: `Ralph ${role}: ${run.taskPath} (iteration ${run.iteration})`,
			prompt,
			agentConfig: profile.config,
			maxTurns,
			maxTokens: run.budgets.maxTokens - run.totalTokens,
			hardTurnLimit: true,
			toolExecution: "sequential",
			thinkingLevel: role === "executor" ? "high" : "xhigh",
			cwd: run.projectRoot,
			signal,
			toolPolicy,
			customTools: [resultTool.tool],
			internalOwner: `ralph:${run.runId}`,
			onStarted: (agentId) => {
				control.agentId = agentId;
			},
			onAssistantUsage: (usage) => {
				liveTokens += usage.input + usage.output + usage.cacheWrite;
				if (run.totalTokens + liveTokens >= run.budgets.maxTokens && !control.forcedGate) {
					control.forcedGate = {
						state: "budget_exhausted",
						reason: `Token budget reached during ${role}`,
						cause: "aggregate_token_ceiling",
					};
					control.abort.abort();
				}
			},
			onCompaction: () => {
				if (!control.forcedGate)
					control.forcedGate = {
						state: "compacted",
						reason: `${role} compacted and no longer has the curated fresh context`,
						cause: "compaction",
					};
				control.abort.abort();
			},
		});
		control.agentId = undefined;
		return { record, output: resultTool.value(), submissionCount: resultTool.calls() };
	}

	private async accountAgent(
		run: RalphRun,
		stage: RalphRole,
		record: Awaited<ReturnType<ManagedSubagentService["runFresh"]>>,
		skillHash: string,
		control: ActiveRunControl,
		allowStopped = false,
	): Promise<RalphRun> {
		run.activeAgentId = undefined;
		const tokens = getLifetimeTotal(record.lifetimeUsage);
		run.totalTokens += tokens;
		run.updatedAt = new Date().toISOString();
		await appendReceipt(run, {
			stage,
			agentId: record.id,
			sessionFile: record.sessionFile,
			roleSkillHash: skillHash,
			usage: record.lifetimeUsage,
			compactions: record.compactionCount,
			outcome: record.status,
		});
		if (control.stopRequested)
			throw new RalphGateError("stopped", `Stopped by the operator during ${stage}`, "operator_stop");
		if (control.externalCancelled)
			throw new RalphGateError("interrupted", `Cancelled by the caller during ${stage}`, "external_cancellation");
		if (control.forcedGate)
			throw new RalphGateError(control.forcedGate.state, control.forcedGate.reason, control.forcedGate.cause);
		if (record.compactionCount > 0)
			throw new RalphGateError(
				"compacted",
				`${stage} compacted and no longer has the curated fresh context`,
				"compaction",
			);
		if (run.totalTokens >= run.budgets.maxTokens)
			throw new RalphGateError(
				"budget_exhausted",
				`Token budget reached: ${run.totalTokens}/${run.budgets.maxTokens}`,
				"aggregate_token_ceiling",
			);
		if (record.status === "steered" || record.status === "aborted") {
			throw new RalphGateError(
				control.externalCancelled ? "interrupted" : "budget_exhausted",
				control.externalCancelled ? `${stage} was cancelled by the caller` : `${stage} exceeded its turn budget`,
				control.externalCancelled ? "external_cancellation" : "role_turn_ceiling",
			);
		}
		if (record.status === "stopped" && !allowStopped) {
			const timedOut = this.elapsedSeconds(run) >= run.budgets.timeoutSeconds;
			throw new RalphGateError(
				control.stopRequested
					? "stopped"
					: control.externalCancelled
						? "interrupted"
						: timedOut
							? "budget_exhausted"
							: "interrupted",
				`${stage} was stopped`,
				control.stopRequested
					? "operator_stop"
					: control.externalCancelled
						? "external_cancellation"
						: timedOut
							? "elapsed_time_ceiling"
							: "internal_error",
			);
		}
		if (record.status === "error")
			throw new RalphGateError("error", `${stage} failed: ${record.error ?? "unknown error"}`, "provider_error");
		return run;
	}

	private async closeIfSupported(
		run: RalphRun,
		graph: ReturnType<typeof compileWorkGraph>,
		review: ReviewerOutput,
		judgment: JudgeOutput,
	): Promise<RalphRun> {
		const missingEvidence = missingCriterionEvidence(graph);
		const assessments = new Map(judgment.acceptanceCriteria.map((criterion) => [criterion.id, criterion.status]));
		const unsatisfied = graph.criteria
			.filter((criterion) => assessments.get(criterion.id) !== "satisfied")
			.map((criterion) => criterion.id);
		const severeFindings = review.findings.filter(
			(finding) => finding.severity === "critical" || finding.severity === "significant",
		);
		const openWorkItems =
			graph.task.taskDocument?.workItems.filter((item) => item.state === "open").map((item) => item.id) ?? [];
		const workItemIssues = graph.task.taskDocument?.workItemIssues ?? [];
		const failures = [
			...(review.verdict === "pass" ? [] : [`review verdict is ${review.verdict}`]),
			...(severeFindings.length === 0 ? [] : ["review has closure-blocking findings"]),
			...(missingEvidence.length === 0 ? [] : [`task Evidence omits ${missingEvidence.join(", ")}`]),
			...(unsatisfied.length === 0 ? [] : [`judgment does not satisfy ${unsatisfied.join(", ")}`]),
			...(hasRetrospective(graph) ? [] : ["task Retrospective is missing or placeholder"]),
			...(hasDistillation(graph) ? [] : ["task Distillation is missing or placeholder"]),
			...(openWorkItems.length === 0 ? [] : [`task Work Items remain open: ${openWorkItems.join(", ")}`]),
			...(workItemIssues.length === 0 ? [] : ["task Work Items are malformed"]),
		];
		if (failures.length > 0) return this.gate(run, "evidence_failed", failures.join("; "));
		await closeTask(graph.task.absolutePath, graph.task.digest);
		run.expectedWorkspace = captureWorkspace(run.projectRoot);
		run.state = "done";
		run.lastOutcome = judgment.reason;
		run.nextObjective = undefined;
		run.updatedAt = new Date().toISOString();
		await appendReceipt(run, {
			outcome: "task_closed",
			structuredOutput: judgment,
			workspaceHashAfter: run.expectedWorkspace.hash,
		});
		return run;
	}

	private async gate(
		run: RalphRun,
		state: RalphTerminalState,
		reason: string,
		cause = this.causeForGate(state, reason),
	): Promise<RalphRun> {
		run.state = state;
		run.lastOutcome = reason;
		run.terminalCause = cause;
		run.activeAgentId = undefined;
		run.updatedAt = new Date().toISOString();
		await appendReceipt(run, { outcome: "gate", gate: { kind: state, reason } });
		return run;
	}

	private causeForGate(state: RalphTerminalState, _reason: string): RalphTerminalCause | undefined {
		if (state === "done") return undefined;
		if (state === "blocked") return "blocked";
		if (state === "review_failed") return "review_failure";
		if (state === "evidence_failed") return "evidence_failure";
		if (state === "workspace_conflict") return "workspace_conflict";
		if (state === "authority_required") return "authority_denial";
		if (state === "compacted") return "compaction";
		if (state === "stopped") return "operator_stop";
		if (state === "interrupted") return "external_cancellation";
		if (state === "budget_exhausted") return "internal_error";
		return "internal_error";
	}

	private async handleFailure(run: RalphRun, error: unknown): Promise<RalphRun> {
		if (error instanceof RalphGateError) return this.gate(run, error.state, error.message, error.cause);
		if (error instanceof WorkspaceError) {
			return this.gate(
				run,
				error.code === "workspace_conflict" || error.code === "head_changed" || error.code === "branch_changed"
					? "workspace_conflict"
					: "error",
				error.message,
			);
		}
		if (error instanceof WorkGraphError) {
			const state: RalphTerminalState =
				error.code === "task_blocked" || error.code === "inactive_authority"
					? "blocked"
					: error.code === "semantic_authority_changed"
						? "workspace_conflict"
						: "error";
			return this.gate(run, state, error.message);
		}
		return this.gate(run, "error", error instanceof Error ? error.message : String(error));
	}

	private assertGraphUnchanged(run: RalphRun, actualHash: string): void {
		if (run.graphHash !== actualHash) {
			throw new WorkGraphError("Ledger authority changed outside the Ralph controller", "semantic_authority_changed");
		}
	}

	private assertExecutionContext(ctx: ExtensionContext): void {
		if (!ctx.isProjectTrusted()) throw new Error("Ralph execution requires a trusted project");
		if (!ctx.model) throw new Error("Ralph execution requires an active model");
	}

	private elapsedSeconds(run: RalphRun): number {
		return (Date.now() - Date.parse(run.startedAt)) / 1000;
	}
}

function substantiveWorkItemEvidence(value: string): boolean {
	const normalized = value.trim();
	return normalized.length >= 12 && !/^(?:none|n\/a|todo|pending|tbd|not yet|will be)(?:\b|[.:])/i.test(normalized);
}

function validateWorkItemProposals(
	graph: ReturnType<typeof compileWorkGraph>,
	proposals: WorkItemCompletionProposal[],
): WorkItemCompletionProposal[] {
	const items = graph.task.taskDocument?.workItems ?? [];
	const known = new Map(items.map((item) => [item.id, item]));
	const ids = new Set<string>();
	for (const proposal of proposals) {
		if (ids.has(proposal.id))
			throw new RalphGateError("error", `Duplicate work-item proposal: ${proposal.id}`, "invalid_output");
		ids.add(proposal.id);
		if (known.get(proposal.id)?.state !== "open")
			throw new RalphGateError(
				"error",
				`Work-item proposal must target a known open item: ${proposal.id}`,
				"invalid_output",
			);
		if (!substantiveWorkItemEvidence(proposal.evidence))
			throw new RalphGateError(
				"error",
				`Work-item proposal lacks substantive evidence: ${proposal.id}`,
				"invalid_output",
			);
	}
	return proposals;
}

function validateWorkItemJudgments(
	proposals: WorkItemCompletionProposal[],
	judgments: WorkItemJudgment[],
): WorkItemJudgment[] {
	const proposed = new Set(proposals.map((proposal) => proposal.id));
	const assessed = new Set<string>();
	for (const assessment of judgments) {
		if (!proposed.has(assessment.id) || assessed.has(assessment.id))
			throw new RalphGateError(
				"error",
				`Judge must assess each proposed work item exactly once: ${assessment.id}`,
				"invalid_output",
			);
		if (!substantiveWorkItemEvidence(assessment.reason))
			throw new RalphGateError(
				"error",
				`Work-item judgment lacks substantive reason: ${assessment.id}`,
				"invalid_output",
			);
		assessed.add(assessment.id);
	}
	if (assessed.size !== proposed.size)
		throw new RalphGateError("error", "Judge omitted a proposed work-item assessment", "invalid_output");
	return judgments;
}

function ralphReviewOutput(run: ReviewRun): ReviewerOutput {
	const findings = run.findings.filter((finding) => finding.validation.status !== "rejected");
	const severe = findings.some((finding) => finding.severity === "critical" || finding.severity === "significant");
	const incomplete = run.state !== "complete" && run.state !== "skipped";
	return {
		verdict: incomplete || severe ? "fail" : findings.length > 0 ? "concerns" : "pass",
		summary: run.lastOutcome ?? `Shared review finished with state ${run.state}`,
		findings: findings.map((finding) => ({
			severity: finding.severity,
			summary: finding.summary,
			evidence: `${finding.impact} Evidence: ${finding.evidence} Verification: ${finding.validation.status} — ${finding.validation.reason}`,
			path: finding.path,
		})),
		residualRisk: [
			...run.residualRisk,
			...(incomplete
				? [`Shared review coverage was ${run.completedItemIds.length}/${run.selected.length}; closure is unsupported.`]
				: []),
			...findings
				.filter((finding) => finding.anchorProvenance === "ambiguous" || finding.anchorProvenance === "unresolved")
				.map((finding) => `Finding ${finding.id} has ${finding.anchorProvenance} source anchoring.`),
		],
	};
}

class RalphGateError extends Error {
	constructor(
		readonly state: RalphTerminalState,
		message: string,
		readonly cause?: RalphTerminalCause,
	) {
		super(message);
		this.name = "RalphGateError";
	}
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || value < min || value > max)
		throw new Error(`Budget must be an integer between ${min} and ${max}`);
	return value;
}

export function deriveRalphBudgets(
	mode: RalphMode,
	graph: Pick<ReturnType<typeof compileWorkGraph>, "records" | "byteLength">,
): RalphBudgets {
	const scale = Math.max(1, Math.ceil(graph.byteLength / (64 * 1024)), Math.ceil(graph.records.length / 8));
	return {
		maxIterations: mode === "step" ? 1 : Math.min(10, Math.max(2, scale * 2)),
		maxTokens: Math.min(1_000_000, 250_000 + scale * 100_000),
		timeoutSeconds: Math.min(7_200, 1_800 + scale * 900),
		executorMaxTurns: Math.min(80, 24 + scale * 8),
		reviewerMaxTurns: Math.min(30, 12 + scale * 4),
		judgeMaxTurns: Math.min(20, 8 + scale * 2),
	};
}

/** Internal test/config normalization only. Normal model and slash-command calls do not supply this input. */
export function normalizeBudgets(
	input: Partial<RalphBudgets> = {},
	fallback: RalphBudgets = DEFAULT_RALPH_BUDGETS,
): RalphBudgets {
	return {
		maxIterations: boundedInteger(input.maxIterations, fallback.maxIterations, 1, 100),
		maxTokens: boundedInteger(input.maxTokens, fallback.maxTokens, 10_000, 10_000_000),
		timeoutSeconds: boundedInteger(input.timeoutSeconds, fallback.timeoutSeconds, 60, 86_400),
		executorMaxTurns: boundedInteger(input.executorMaxTurns, fallback.executorMaxTurns, 1, 500),
		reviewerMaxTurns: boundedInteger(input.reviewerMaxTurns, fallback.reviewerMaxTurns, 1, 200),
		judgeMaxTurns: boundedInteger(input.judgeMaxTurns, fallback.judgeMaxTurns, 1, 200),
	};
}

export function summarizeRun(run: RalphRun): string {
	return [
		`Run: ${run.runId}`,
		`State: ${run.state}`,
		`Workspace: ${run.projectRoot}`,
		`Ledger: ${run.ledgerRoot}`,
		`Task: ${run.taskPath}`,
		`Iteration: ${run.iteration}/${run.budgets.maxIterations}`,
		`Tokens: ${run.totalTokens}/${run.budgets.maxTokens}`,
		...(run.terminalCause ? [`Cause: ${run.terminalCause}`] : []),
		...(run.nextObjective ? [`Next objective: ${run.nextObjective}`] : []),
		...(run.lastOutcome ? [`Outcome: ${run.lastOutcome}`] : []),
		`Receipt: ${receiptPath(run.projectRoot, run.runId)}`,
	].join("\n");
}
