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
	recordExecutorOutcome,
} from "./task.js";
import type {
	ExecutorOutput,
	JudgeOutput,
	RalphAgentRole,
	RalphBudgets,
	RalphMode,
	RalphRole,
	RalphRun,
	RalphState,
	RalphTerminalState,
	ReviewerOutput,
	RunSummary,
	WorkspaceSnapshot,
} from "./types.js";
import { compileWorkGraph, hasDistillation, hasRetrospective, missingCriterionEvidence, WorkGraphError } from "./work-graph.js";
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
	"done", "blocked", "review_failed", "evidence_failed", "workspace_conflict",
	"authority_required", "budget_exhausted", "compacted", "interrupted", "stopped", "error",
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
	forcedGate?: { state: RalphTerminalState; reason: string };
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
		const budgets = normalizeBudgets(options.budgets);
		const roots = resolveRalphRoots(ctx.cwd, options.root, options.ledgerRoot);
		const preflight = compileWorkGraph(roots.workspaceRoot, taskPath, {}, roots.ledgerRoot);
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
			startedAt: now,
			updatedAt: now,
			graphHash: graph.graphHash,
			baselineWorkspace,
			expectedWorkspace,
			totalTokens: 0,
		};
			await appendReceipt(run, { outcome: "run_started", graphHash: graph.graphHash, workspaceHashAfter: expectedWorkspace.hash });
			return run;
		} finally {
			releaseLeases();
		}
	}

	async step(ctx: ExtensionContext, runId: string, signal?: AbortSignal, root?: string): Promise<RalphRun> {
		return this.continue(ctx, runId, 1, signal, root);
	}

	async run(ctx: ExtensionContext, taskPath: string, options: StartRunOptions = {}, signal?: AbortSignal): Promise<RalphRun> {
		const run = await this.start(ctx, taskPath, { ...options, mode: "auto" });
		return this.continue(ctx, run.runId, run.budgets.maxIterations, signal, run.projectRoot);
	}

	async continue(ctx: ExtensionContext, runId: string, maxIterations: number, signal?: AbortSignal, root?: string): Promise<RalphRun> {
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
				run = await this.gate(run, "interrupted", "A prior process ended during an agent stage; Ralph never resumes that context");
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
		const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });
		const control: ActiveRunControl = {
			abort: new AbortController(),
			agentId: undefined,
			projectRoot: run.projectRoot,
			stopRequested: false,
			settled,
			resolveSettled,
		};
		this.active.set(runId, control);
		const onExternalAbort = () => control.abort.abort();
		signal?.addEventListener("abort", onExternalAbort, { once: true });
		if (signal?.aborted) control.abort.abort();
		try {
			for (let count = 0; count < maxIterations; count++) {
				if (run.iteration >= run.budgets.maxIterations) {
					return await this.gate(run, "budget_exhausted", `Maximum iterations reached: ${run.budgets.maxIterations}`);
				}
				if (this.elapsedSeconds(run) >= run.budgets.timeoutSeconds || run.totalTokens >= run.budgets.maxTokens) {
					return await this.gate(run, "budget_exhausted", "Run time or token budget exhausted before the next iteration");
				}
				run.iteration++;
				run.updatedAt = new Date().toISOString();
				run = await this.runIteration(ctx, run, control);
				if (run.state !== "iterating") return run;
				if (run.mode === "step") return run;
			}
			return run.state === "iterating"
				? await this.gate(run, "budget_exhausted", `Invocation iteration limit reached: ${maxIterations}`)
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
		const releaseLeases = acquireRalphRunLeases(discovered.projectRoot, discovered.ledgerRoot, discovered.taskPath, `stop-${runId}-${process.pid}`);
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

	private async runIteration(
		ctx: ExtensionContext,
		run: RalphRun,
		control: ActiveRunControl,
	): Promise<RalphRun> {
		let graph = compileWorkGraph(run.projectRoot, run.taskPath, {}, run.ledgerRoot);
		this.assertGraphUnchanged(run, graph.graphHash);
		assertWorkspaceMatches(run.expectedWorkspace, captureWorkspace(run.projectRoot));
		const beforeExecutor = run.expectedWorkspace;

		run.state = "executing";
		run.updatedAt = new Date().toISOString();
		const executorProfile = roleProfile("executor");
		await appendReceipt(run, { stage: "executor", outcome: "stage_started", graphHash: graph.graphHash, roleSkillHash: executorProfile.skillHash, workspaceHashBefore: run.expectedWorkspace.hash });
		const denials: AuthorityDenial[] = [];
		const executorStageAbort = new AbortController();
		const executorRecord = await this.runRole(
			ctx,
			run,
			control,
			"executor",
			executorPrompt(graph, run.iteration, run.nextObjective),
			executorProfile,
			createExecutorAuthorityPolicy(run.projectRoot, (denial) => {
				denials.push(denial);
				executorStageAbort.abort();
			}, run.ledgerRoot),
			executorStageAbort.signal,
		);
		run = await this.accountAgent(run, "executor", executorRecord, executorProfile.skillHash, control, denials.length > 0);
		const afterExecutorTools = captureWorkspace(run.projectRoot);
		run.expectedWorkspace = afterExecutorTools;
		if (denials.length > 0) return this.gate(run, "authority_required", denials.map((denial) => denial.reason).join("; "));
		const semanticChanges = changedPaths(beforeExecutor, afterExecutorTools).filter((change) => change.path === ".ledger" || change.path.startsWith(".ledger/"));
		if (semanticChanges.length > 0) {
			return this.gate(run, "authority_required", `Executor changed semantic authority directly: ${semanticChanges.map((change) => change.path).join(", ")}`);
		}
		this.assertGraphUnchanged(run, compileWorkGraph(run.projectRoot, run.taskPath, {}, run.ledgerRoot).graphHash);
		const executor = parseExecutorOutput(executorRecord.result ?? "");
		await recordExecutorOutcome(graph.task.absolutePath, graph.task.digest, run.runId, run.iteration, executor);
		const afterExecutor = captureWorkspace(run.projectRoot);
		run.expectedWorkspace = afterExecutor;
		if (executor.status === "blocked") {
			await appendReceipt(run, { stage: "executor", outcome: executor.status, structuredOutput: executor, workspaceHashAfter: afterExecutor.hash });
			return this.gate(run, "blocked", executor.blockers.join("; ") || executor.summary);
		}
		graph = compileWorkGraph(run.projectRoot, run.taskPath, {}, run.ledgerRoot);
		run.graphHash = graph.graphHash;
		await appendReceipt(run, { stage: "executor", outcome: executor.status, structuredOutput: executor, workspaceHashAfter: afterExecutor.hash });
		if (executor.status === "failed") return this.gate(run, "error", executor.summary);
		run.state = "reviewing";
		run.updatedAt = new Date().toISOString();
		await appendReceipt(run, { stage: "reviewer", outcome: "stage_started", graphHash: graph.graphHash, workspaceHashBefore: afterExecutor.hash });
		const remainingSeconds = Math.max(1, run.budgets.timeoutSeconds - this.elapsedSeconds(run));
		const remainingReviewTokens = run.budgets.maxTokens - run.totalTokens;
		if (remainingReviewTokens < 10_000) return this.gate(run, "budget_exhausted", `Fewer than 10,000 tokens remain for independent review: ${remainingReviewTokens}`);
		const reviewSignal = AbortSignal.any([control.abort.signal, AbortSignal.timeout(remainingSeconds * 1000)]);
		const reviewRun = await this.reviewController.run(ctx, { mode: "workspace" }, {
			root: run.projectRoot,
			profile: "balanced",
			background: `Ralph iteration ${run.iteration} executor report:\n${JSON.stringify(executor, null, 2)}`,
			authorityPacket: graph.bundle,
			budgets: {
				maxTokens: remainingReviewTokens,
				timeoutSeconds: Math.max(60, Math.ceil(remainingSeconds)),
				plannerMaxTurns: Math.min(100, run.budgets.reviewerMaxTurns),
				reviewerMaxTurns: run.budgets.reviewerMaxTurns,
				verifierMaxTurns: Math.min(100, run.budgets.reviewerMaxTurns),
			},
		}, reviewSignal);
		run.totalTokens += reviewRun.totalTokens;
		if (control.stopRequested) throw new RalphGateError("stopped", "Stopped by the operator during independent review");
		if (run.totalTokens >= run.budgets.maxTokens) return this.gate(run, "budget_exhausted", `Token budget reached: ${run.totalTokens}/${run.budgets.maxTokens}`);
		const afterReviewer = captureWorkspace(run.projectRoot);
		assertWorkspaceMatches(afterExecutor, afterReviewer);
		const review = ralphReviewOutput(reviewRun);
		await appendReceipt(run, { stage: "reviewer", outcome: review.verdict, structuredOutput: { reviewRunId: reviewRun.runId, review }, workspaceHashAfter: afterReviewer.hash });
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
		await appendReceipt(run, { stage: "judge", outcome: "stage_started", graphHash: graph.graphHash, roleSkillHash: judgeProfileValue.skillHash, workspaceHashBefore: run.expectedWorkspace.hash });
		const beforeJudge = run.expectedWorkspace;
		const judgeDenials: AuthorityDenial[] = [];
		const judgeStageAbort = new AbortController();
		const judgeRecord = await this.runRole(
			ctx,
			run,
			control,
			"judge",
			judgePrompt(graph, judgedChanges.text, executor, review),
			judgeProfileValue,
			createExecutorAuthorityPolicy(run.projectRoot, (denial) => {
				judgeDenials.push(denial);
				judgeStageAbort.abort();
			}, run.ledgerRoot),
			judgeStageAbort.signal,
		);
		run = await this.accountAgent(run, "judge", judgeRecord, judgeProfileValue.skillHash, control, judgeDenials.length > 0);
		if (judgeDenials.length > 0) return this.gate(run, "authority_required", judgeDenials.map((denial) => denial.reason).join("; "));
		const afterJudge = captureWorkspace(run.projectRoot);
		assertWorkspaceMatches(beforeJudge, afterJudge);
		const judgment = parseJudgeOutput(judgeRecord.result ?? "");
		await appendReceipt(run, { stage: "judge", outcome: judgment.decision, structuredOutput: judgment, workspaceHashAfter: afterJudge.hash });
		this.assertGraphUnchanged(run, compileWorkGraph(run.projectRoot, run.taskPath, {}, run.ledgerRoot).graphHash);
		await appendJudgment(graph.task.absolutePath, graph.task.digest, run.runId, run.iteration, judgment);
		run.expectedWorkspace = captureWorkspace(run.projectRoot);
		graph = compileWorkGraph(run.projectRoot, run.taskPath, {}, run.ledgerRoot);
		run.graphHash = graph.graphHash;

		if (judgment.decision === "close") return this.closeIfSupported(run, graph, review, judgment);
		if (judgment.decision === "blocked") {
			await blockTask(graph.task.absolutePath, graph.task.digest, judgment.reason);
			run.expectedWorkspace = captureWorkspace(run.projectRoot);
			return this.gate(run, "blocked", judgment.reason);
		}
		if (judgment.decision === "stop") return this.gate(run, "stopped", judgment.reason);

		run.state = "iterating";
		run.nextObjective = judgment.nextObjective;
		run.lastOutcome = judgment.reason;
		run.updatedAt = new Date().toISOString();
		await appendRunJournal(graph.task.absolutePath, graph.task.digest, run.runId, run.iteration, `Judgment requested another fresh iteration: ${judgment.reason}`);
		run.expectedWorkspace = captureWorkspace(run.projectRoot);
		graph = compileWorkGraph(run.projectRoot, run.taskPath, {}, run.ledgerRoot);
		run.graphHash = graph.graphHash;
		await appendReceipt(run, { outcome: "iteration_complete", structuredOutput: judgment, workspaceHashAfter: run.expectedWorkspace.hash });
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
		if (control.stopRequested || control.abort.signal.aborted) throw new RalphGateError(control.stopRequested ? "stopped" : "interrupted", "Run was cancelled before the next fresh role");
		if (run.totalTokens >= run.budgets.maxTokens) throw new RalphGateError("budget_exhausted", "No token budget remains for the next fresh role");
		const remainingMs = Math.max(1, run.budgets.timeoutSeconds * 1000 - (Date.now() - Date.parse(run.startedAt)));
		const timeout = AbortSignal.timeout(remainingMs);
		const signals = [control.abort.signal, timeout, ...(stageAbort ? [stageAbort] : [])];
		const signal = AbortSignal.any(signals);
		const maxTurns = role === "executor" ? run.budgets.executorMaxTurns : run.budgets.judgeMaxTurns;
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
			internalOwner: `ralph:${run.runId}`,
			onStarted: (agentId) => { control.agentId = agentId; },
			onAssistantUsage: (usage) => {
				liveTokens += usage.input + usage.output + usage.cacheWrite;
				if (run.totalTokens + liveTokens >= run.budgets.maxTokens && !control.forcedGate) {
					control.forcedGate = { state: "budget_exhausted", reason: `Token budget reached during ${role}` };
					control.abort.abort();
				}
			},
			onCompaction: () => {
				if (!control.forcedGate) control.forcedGate = { state: "compacted", reason: `${role} compacted and no longer has the curated fresh context` };
				control.abort.abort();
			},
		});
		control.agentId = undefined;
		return record;
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
		if (control.stopRequested) throw new RalphGateError("stopped", `Stopped by the operator during ${stage}`);
		if (control.forcedGate) throw new RalphGateError(control.forcedGate.state, control.forcedGate.reason);
		if (record.compactionCount > 0) throw new RalphGateError("compacted", `${stage} compacted and no longer has the curated fresh context`);
		if (run.totalTokens >= run.budgets.maxTokens) throw new RalphGateError("budget_exhausted", `Token budget reached: ${run.totalTokens}/${run.budgets.maxTokens}`);
		if (record.status === "steered" || record.status === "aborted") throw new RalphGateError("budget_exhausted", `${stage} exceeded its turn budget`);
		if (record.status === "stopped" && !allowStopped) {
			const timedOut = this.elapsedSeconds(run) >= run.budgets.timeoutSeconds;
			throw new RalphGateError(control.stopRequested ? "stopped" : timedOut ? "budget_exhausted" : "interrupted", `${stage} was stopped`);
		}
		if (record.status === "error") throw new RalphGateError("error", `${stage} failed: ${record.error ?? "unknown error"}`);
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
		const unsatisfied = graph.criteria.filter((criterion) => assessments.get(criterion.id) !== "satisfied").map((criterion) => criterion.id);
		const severeFindings = review.findings.filter((finding) => finding.severity === "critical" || finding.severity === "significant");
		const failures = [
			...(review.verdict === "pass" ? [] : [`review verdict is ${review.verdict}`]),
			...(severeFindings.length === 0 ? [] : ["review has closure-blocking findings"]),
			...(missingEvidence.length === 0 ? [] : [`task Evidence omits ${missingEvidence.join(", ")}`]),
			...(unsatisfied.length === 0 ? [] : [`judgment does not satisfy ${unsatisfied.join(", ")}`]),
			...(hasRetrospective(graph) ? [] : ["task Retrospective is missing or placeholder"]),
			...(hasDistillation(graph) ? [] : ["task Distillation is missing or placeholder"]),
		];
		if (failures.length > 0) return this.gate(run, "evidence_failed", failures.join("; "));
		await closeTask(graph.task.absolutePath, graph.task.digest);
		run.expectedWorkspace = captureWorkspace(run.projectRoot);
		run.state = "done";
		run.lastOutcome = judgment.reason;
		run.nextObjective = undefined;
		run.updatedAt = new Date().toISOString();
		await appendReceipt(run, { outcome: "task_closed", structuredOutput: judgment, workspaceHashAfter: run.expectedWorkspace.hash });
		return run;
	}

	private async gate(run: RalphRun, state: RalphTerminalState, reason: string): Promise<RalphRun> {
		run.state = state;
		run.lastOutcome = reason;
		run.activeAgentId = undefined;
		run.updatedAt = new Date().toISOString();
		await appendReceipt(run, { outcome: "gate", gate: { kind: state, reason } });
		return run;
	}

	private async handleFailure(run: RalphRun, error: unknown): Promise<RalphRun> {
		if (error instanceof RalphGateError) return this.gate(run, error.state, error.message);
		if (error instanceof WorkspaceError) {
			return this.gate(run, error.code === "workspace_conflict" || error.code === "head_changed" || error.code === "branch_changed" ? "workspace_conflict" : "error", error.message);
		}
		if (error instanceof WorkGraphError) {
			const state: RalphTerminalState = error.code === "task_blocked" || error.code === "inactive_authority"
				? "blocked"
				: error.code === "semantic_authority_changed" ? "workspace_conflict" : "error";
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
			...(incomplete ? [`Shared review coverage was ${run.completedItemIds.length}/${run.selected.length}; closure is unsupported.`] : []),
			...findings.filter((finding) => finding.anchorProvenance === "ambiguous" || finding.anchorProvenance === "unresolved")
				.map((finding) => `Finding ${finding.id} has ${finding.anchorProvenance} source anchoring.`),
		],
	};
}

class RalphGateError extends Error {
	constructor(readonly state: RalphTerminalState, message: string) {
		super(message);
		this.name = "RalphGateError";
	}
}

function boundedInteger(value: number | undefined, fallback: number, min: number, max: number): number {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || value < min || value > max) throw new Error(`Budget must be an integer between ${min} and ${max}`);
	return value;
}

export function normalizeBudgets(input: Partial<RalphBudgets> = {}): RalphBudgets {
	return {
		maxIterations: boundedInteger(input.maxIterations, DEFAULT_RALPH_BUDGETS.maxIterations, 1, 100),
		maxTokens: boundedInteger(input.maxTokens, DEFAULT_RALPH_BUDGETS.maxTokens, 10_000, 10_000_000),
		timeoutSeconds: boundedInteger(input.timeoutSeconds, DEFAULT_RALPH_BUDGETS.timeoutSeconds, 60, 86_400),
		executorMaxTurns: boundedInteger(input.executorMaxTurns, DEFAULT_RALPH_BUDGETS.executorMaxTurns, 1, 500),
		reviewerMaxTurns: boundedInteger(input.reviewerMaxTurns, DEFAULT_RALPH_BUDGETS.reviewerMaxTurns, 1, 200),
		judgeMaxTurns: boundedInteger(input.judgeMaxTurns, DEFAULT_RALPH_BUDGETS.judgeMaxTurns, 1, 200),
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
		...(run.nextObjective ? [`Next objective: ${run.nextObjective}`] : []),
		...(run.lastOutcome ? [`Outcome: ${run.lastOutcome}`] : []),
		`Receipt: ${receiptPath(run.projectRoot, run.runId)}`,
	].join("\n");
}
