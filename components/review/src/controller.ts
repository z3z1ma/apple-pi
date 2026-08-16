import { createHash, randomUUID } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveModelAndThinking } from "../../mode-utils.js";
import { getManagedSubagentService, type ManagedSubagentService } from "../../subagents/src/service.js";
import { getLifetimeTotal } from "../../subagents/src/usage.js";
import { createReviewAuthorityPolicy } from "./authority-policy.js";
import { assertReviewInputUnchanged, materializeReviewTree, previewReviewInput, resolveReviewTargetRoot, reviewRepositoryRoot, ReviewInputError } from "./git.js";
import { activeReviewLease, acquireReviewLease } from "./lease.js";
import { resolveReviewAnchor } from "./location.js";
import { appendReviewReceipt, listReviewRunSummaries, loadReviewRun, reviewReceiptPath } from "./receipts.js";
import {
	parsePlannerOutput,
	parseReviewerOutput,
	parseVerifierOutput,
	plannerPrompt,
	reviewerPrompt,
	reviewRoleProfile,
	verifierPrompt,
} from "./roles.js";
import type {
	ProposedReviewFinding,
	ReviewAgentReceipt,
	ReviewBudgets,
	ReviewCoverageFailure,
	ReviewFinding,
	ReviewGroup,
	ReviewInput,
	ReviewModelRouting,
	ReviewModelTier,
	ReviewProfile,
	ReviewRun,
	ReviewRunSummary,
	ReviewSource,
	StartReviewOptions,
} from "./types.js";
import { compileReviewWorkGraph } from "./work-graph.js";

export const DEFAULT_REVIEW_BUDGETS: ReviewBudgets = {
	maxTokens: 500_000,
	timeoutSeconds: 3_600,
	maxConcurrency: 4,
	plannerMaxTurns: 12,
	reviewerMaxTurns: 25,
	verifierMaxTurns: 15,
	maxGroups: 32,
	maxPromptBytes: 384 * 1024,
};

export const DEFAULT_REVIEW_ROUTING: ReviewModelRouting = {
	plannerMode: "review-planner",
	fastMode: "review-fast",
	strongMode: "review-strong",
};

const TERMINAL = new Set([
	"complete", "partial", "failed", "skipped", "stopped", "workspace_conflict", "error",
]);

export interface ResolvedReviewModel {
	model: Model<any>;
	thinkingLevel: string;
	mode: string;
	tier: ReviewModelTier;
}

export interface ReviewControllerDependencies {
	getService?: () => ManagedSubagentService | undefined;
	resolveModel?: (ctx: ExtensionContext, mode: string, tier: ReviewModelTier) => Promise<ResolvedReviewModel>;
}

interface ActiveReview {
	abort: AbortController;
	activeAgentIds: Set<string>;
	stopRequested: boolean;
	budgetExceeded: boolean;
	inflightTokens: number;
	run: ReviewRun;
	reviewRoot: string;
	cleanupReviewRoot: () => void;
	releaseLease: () => void;
	settled: Promise<void>;
	resolveSettled: () => void;
}

class ReviewStageError extends Error {
	constructor(
		message: string,
		readonly classification: ReviewCoverageFailure["classification"],
	) {
		super(message);
		this.name = "ReviewStageError";
	}
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function safeReason(value: unknown): string {
	const raw = value instanceof Error ? value.message : String(value);
	return raw
		.replace(/(?:sk-|ghp_|github_pat_)[A-Za-z0-9_-]{12,}/g, "[redacted]")
		.replace(/(?:api[_-]?key|token|authorization)\s*[:=]\s*\S+/gi, "$1=[redacted]")
		.slice(0, 500);
}

function exactIds(actual: string[], expected: string[], label: string): void {
	const left = [...actual].sort();
	const right = [...expected].sort();
	if (left.length !== right.length || left.some((id, index) => id !== right[index])) {
		throw new ReviewStageError(`${label} did not account for exactly its assigned review items`, "invalid_output");
	}
}

async function parallelLimit<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
	const results = new Array<R>(items.length);
	let next = 0;
	const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
		for (;;) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await work(items[index]);
		}
	});
	await Promise.all(workers);
	return results;
}

function normalizeBudgets(input: Partial<ReviewBudgets> = {}): ReviewBudgets {
	const integer = (value: number | undefined, fallback: number, min: number, max: number, name: string): number => {
		if (value === undefined) return fallback;
		if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
		return value;
	};
	return {
		maxTokens: integer(input.maxTokens, DEFAULT_REVIEW_BUDGETS.maxTokens, 10_000, 10_000_000, "maxTokens"),
		timeoutSeconds: integer(input.timeoutSeconds, DEFAULT_REVIEW_BUDGETS.timeoutSeconds, 60, 86_400, "timeoutSeconds"),
		maxConcurrency: integer(input.maxConcurrency, DEFAULT_REVIEW_BUDGETS.maxConcurrency, 1, 16, "maxConcurrency"),
		plannerMaxTurns: integer(input.plannerMaxTurns, DEFAULT_REVIEW_BUDGETS.plannerMaxTurns, 1, 100, "plannerMaxTurns"),
		reviewerMaxTurns: integer(input.reviewerMaxTurns, DEFAULT_REVIEW_BUDGETS.reviewerMaxTurns, 1, 200, "reviewerMaxTurns"),
		verifierMaxTurns: integer(input.verifierMaxTurns, DEFAULT_REVIEW_BUDGETS.verifierMaxTurns, 1, 100, "verifierMaxTurns"),
		maxGroups: integer(input.maxGroups, DEFAULT_REVIEW_BUDGETS.maxGroups, 1, 128, "maxGroups"),
		maxPromptBytes: integer(input.maxPromptBytes, DEFAULT_REVIEW_BUDGETS.maxPromptBytes, 32 * 1024, 2 * 1024 * 1024, "maxPromptBytes"),
	};
}

function normalizeRouting(input: Partial<ReviewModelRouting> = {}): ReviewModelRouting {
	const route = { ...DEFAULT_REVIEW_ROUTING, ...input };
	for (const [name, value] of Object.entries(route)) if (!value.trim()) throw new Error(`${name} must be non-empty`);
	return route;
}

function proposedFindingId(runId: string, groupId: string, index: number, finding: ProposedReviewFinding): string {
	return sha256([runId, groupId, String(index), finding.path, finding.summary, finding.anchor].join("\0")).slice(0, 24);
}

export class ReviewController {
	private readonly active = new Map<string, ActiveReview>();
	private readonly getService: () => ManagedSubagentService | undefined;
	private readonly resolveModelOverride?: ReviewControllerDependencies["resolveModel"];

	constructor(dependencies: ReviewControllerDependencies = {}) {
		this.getService = dependencies.getService ?? getManagedSubagentService;
		this.resolveModelOverride = dependencies.resolveModel;
	}

	preview(projectRoot: string, source: ReviewSource) {
		return previewReviewInput(projectRoot, source);
	}

	async run(ctx: ExtensionContext, source: ReviewSource, options: StartReviewOptions = {}, signal?: AbortSignal): Promise<ReviewRun> {
		this.assertExecutionContext(ctx);
		const preview = previewReviewInput(resolveReviewTargetRoot(ctx.cwd, options.root), source);
		const now = new Date().toISOString();
		const run: ReviewRun = {
			schemaVersion: 1,
			runId: randomUUID(),
			projectRoot: preview.projectRoot,
			source,
			profile: options.profile ?? "balanced",
			state: "planning",
			startedAt: now,
			updatedAt: now,
			inputHash: preview.inputHash,
			...(preview.resolvedBase && { resolvedBase: preview.resolvedBase }),
			...(preview.resolvedHead && { resolvedHead: preview.resolvedHead }),
			selected: preview.reviewable.map(({ diff: _diff, ...entry }) => entry),
			waived: preview.waived.map(({ item, reason }) => ({ itemId: item.id, path: item.path, reason })),
			completedItemIds: [],
			failures: [],
			findings: [],
			residualRisk: [],
			totalTokens: 0,
			budgets: normalizeBudgets(options.budgets),
			routing: normalizeRouting(options.routing),
			agents: [],
		};
		if (run.selected.length === 0) {
			await appendReviewReceipt(run, { stage: "input", outcome: "input_sealed", details: { selected: 0, waived: run.waived.length, inputHash: run.inputHash } });
			run.state = "skipped";
			run.lastOutcome = run.waived.length ? "No reviewable text changes; all selected changes were waived" : "No changes selected for review";
			run.updatedAt = new Date().toISOString();
			await appendReviewReceipt(run, { stage: "finalize", outcome: "skipped" });
			return run;
		}

		const releaseLease = acquireReviewLease(run.projectRoot, run.runId);
		try {
			await appendReviewReceipt(run, { stage: "input", outcome: "input_sealed", details: { selected: run.selected.length, waived: run.waived.length, inputHash: run.inputHash } });
		} catch (error) {
			releaseLease();
			throw error;
		}
		let resolveSettled!: () => void;
		const settled = new Promise<void>((resolve) => { resolveSettled = resolve; });
		const control: ActiveReview = {
			abort: new AbortController(),
			activeAgentIds: new Set(),
			stopRequested: false,
			budgetExceeded: false,
			inflightTokens: 0,
			run,
			reviewRoot: run.projectRoot,
			cleanupReviewRoot: () => {},
			releaseLease,
			settled,
			resolveSettled,
		};
		this.active.set(run.runId, control);
		const onExternalAbort = () => control.abort.abort();
		signal?.addEventListener("abort", onExternalAbort, { once: true });
		if (signal?.aborted) control.abort.abort();
		const input: ReviewInput = {
			projectRoot: preview.projectRoot,
			source,
			...(preview.resolvedBase && { resolvedBase: preview.resolvedBase }),
			...(preview.resolvedHead && { resolvedHead: preview.resolvedHead }),
			items: [...preview.reviewable, ...preview.waived.map(({ item }) => item)],
			inputHash: preview.inputHash,
		};
		try {
			const tree = materializeReviewTree(input);
			control.reviewRoot = tree.root;
			control.cleanupReviewRoot = tree.cleanup;
			await this.plan(ctx, run, input, preview.reviewable, control, options);
			if (control.stopRequested || control.abort.signal.aborted) throw new ReviewStageError("Review stopped", "cancelled");
			assertReviewInputUnchanged(input);
			await this.reviewGroups(ctx, run, input, preview.reviewable, control, options);
			if (control.stopRequested) throw new ReviewStageError("Review stopped", "cancelled");
			assertReviewInputUnchanged(input);
			await this.verifyGroups(ctx, run, input, preview.reviewable, control, options);
			assertReviewInputUnchanged(input);
			if (control.stopRequested) run.state = "stopped";
			else this.deriveTerminalState(run);
		} catch (error) {
			if (control.budgetExceeded) {
				run.state = run.completedItemIds.length > 0 ? "partial" : "failed";
				run.lastOutcome = `Review token budget reached: ${run.totalTokens}/${run.budgets.maxTokens}`;
			} else if (control.stopRequested || (control.abort.signal.aborted && !(error instanceof ReviewInputError))) {
				run.state = "stopped";
				run.lastOutcome = "Stopped by the operator";
			} else if (error instanceof ReviewInputError && (error.code === "workspace_conflict" || error.code === "workspace_changed")) {
				run.state = "workspace_conflict";
				run.lastOutcome = error.message;
			} else {
				const reason = safeReason(error);
				if (!run.workGraph) {
					for (const selected of run.selected) this.addFailure(run, selected.id, selected.path, "planner", reason);
				}
				run.state = run.completedItemIds.length > 0 ? "partial" : "failed";
				run.lastOutcome = reason;
			}
		} finally {
			signal?.removeEventListener("abort", onExternalAbort);
		}
		run.updatedAt = new Date().toISOString();
		try {
			await appendReviewReceipt(run, { stage: "finalize", outcome: run.state, details: { completed: run.completedItemIds.length, failed: run.failures.length, findings: run.findings.length } });
			return run;
		} finally {
			control.cleanupReviewRoot();
			control.releaseLease();
			this.active.delete(run.runId);
			control.resolveSettled();
		}
	}

	status(projectRootInput: string, runId?: string): ReviewRun | ReviewRunSummary[] {
		const projectRoot = reviewRepositoryRoot(projectRootInput);
		return runId ? loadReviewRun(projectRoot, runId) : listReviewRunSummaries(projectRoot);
	}

	async stop(projectRootInput: string, runId: string): Promise<ReviewRun> {
		const projectRoot = reviewRepositoryRoot(projectRootInput);
		const control = this.active.get(runId);
		if (control && control.run.projectRoot !== projectRoot) {
			throw new Error(`Review run ${runId} does not belong to ${projectRoot}`);
		}
		if (control) {
			control.stopRequested = true;
			control.abort.abort();
			for (const agentId of control.activeAgentIds) this.getService()?.abort(agentId);
			control.run.state = "stopped";
			control.run.lastOutcome = "Stopped by the operator";
			control.run.updatedAt = new Date().toISOString();
			await control.settled;
			return loadReviewRun(projectRoot, runId);
		}
		const run = loadReviewRun(projectRoot, runId);
		if (TERMINAL.has(run.state)) return run;
		const owner = activeReviewLease(projectRoot);
		if (owner?.runId === runId) {
			throw new Error(`Review run ${runId} is active in process ${owner.pid}; stop it from the owning Pi session`);
		}
		run.state = "stopped";
		run.lastOutcome = "Stopped by the operator";
		run.updatedAt = new Date().toISOString();
		await appendReviewReceipt(run, { stage: "finalize", outcome: "stopped" });
		return run;
	}

	async stopAll(): Promise<void> {
		const controls = [...this.active.values()];
		for (const control of controls) {
			control.stopRequested = true;
			control.abort.abort();
			for (const agentId of control.activeAgentIds) this.getService()?.abort(agentId);
		}
		await Promise.all(controls.map((control) => control.settled));
	}

	private async plan(ctx: ExtensionContext, run: ReviewRun, input: ReviewInput, items: ReviewInput["items"], control: ActiveReview, options: StartReviewOptions): Promise<void> {
		const route = await this.resolveModel(ctx, run.routing.plannerMode, "fast");
		this.assertActive(control);
		const profile = reviewRoleProfile("planner");
		const prompt = plannerPrompt(input, items, {
			background: options.background,
			authorityPacket: options.authorityPacket,
			reviewRoot: control.reviewRoot,
			maxGroups: run.budgets.maxGroups,
			maxGroupPromptBytes: run.budgets.maxPromptBytes,
			excerptBytes: Math.floor(run.budgets.maxPromptBytes * 0.6),
		});
		this.assertPromptBudget(prompt, run, "planner");
		const record = await this.runRole(ctx, run, control, "planner", undefined, route, profile, prompt, run.budgets.plannerMaxTurns);
		const parsed = parsePlannerOutput(record.result ?? "");
		run.workGraph = compileReviewWorkGraph(parsed, items, run.profile, run.budgets.maxGroups);
		run.updatedAt = new Date().toISOString();
		await appendReviewReceipt(run, { stage: "planner", outcome: "graph_sealed", details: run.workGraph });
	}

	private async reviewGroups(ctx: ExtensionContext, run: ReviewRun, input: ReviewInput, items: ReviewInput["items"], control: ActiveReview, options: StartReviewOptions): Promise<void> {
		if (!run.workGraph) throw new ReviewStageError("Review graph is missing", "planner");
		run.state = "reviewing";
		run.updatedAt = new Date().toISOString();
		await appendReviewReceipt(run, { stage: "reviewer", outcome: "stage_started", details: { groups: run.workGraph.groups.length } });
		const itemById = new Map(items.map((item) => [item.id, item]));
		await parallelLimit(run.workGraph.groups, run.budgets.maxConcurrency, async (group) => {
			const focus = group.itemIds.map((id) => itemById.get(id)!).filter(Boolean);
			try {
				if (control.abort.signal.aborted) throw new ReviewStageError("Review cancelled", "cancelled");
				const mode = group.tier === "strong" ? run.routing.strongMode : run.routing.fastMode;
				const route = await this.resolveModel(ctx, mode, group.tier);
				this.assertActive(control);
				const profile = reviewRoleProfile("reviewer");
				const prompt = reviewerPrompt(input, group, focus, items, { background: options.background, authorityPacket: options.authorityPacket, reviewRoot: control.reviewRoot });
				this.assertPromptBudget(prompt, run, `review group ${group.id}`);
				const record = await this.runRole(ctx, run, control, "reviewer", group.id, route, profile, prompt, run.budgets.reviewerMaxTurns);
				const parsed = parseReviewerOutput(record.result ?? "");
				exactIds(parsed.reviewedItemIds, group.itemIds, `Reviewer ${group.id}`);
				const focusPaths = new Set(focus.map((item) => item.path));
				for (const [index, proposed] of parsed.findings.entries()) {
					if (!focusPaths.has(proposed.path)) throw new ReviewStageError(`Reviewer ${group.id} filed a finding outside its focus: ${proposed.path}`, "invalid_output");
					const candidates = focus.filter((entry) => entry.path === proposed.path && (proposed.side === "old" ? entry.status === "deleted" || entry.status === "renamed" : entry.status !== "deleted"));
					if (candidates.length !== 1) throw new ReviewStageError(`Finding anchor path is not unique in group ${group.id}: ${proposed.path}`, "invalid_output");
					const located = resolveReviewAnchor(run.projectRoot, candidates[0], proposed.anchor, proposed.side, { allowCurrentFile: input.source.mode === "workspace" });
					const finding: ReviewFinding = {
						...proposed,
						id: proposedFindingId(run.runId, group.id, index, proposed),
						groupId: group.id,
						...(located.startLine !== undefined && { startLine: located.startLine }),
						...(located.endLine !== undefined && { endLine: located.endLine }),
						anchorProvenance: located.provenance,
						anchorMatchCount: located.matchCount,
						validation: { status: "retained_unresolved", reason: "Awaiting independent verification", evidence: "Not yet verified" },
					};
					run.findings.push(finding);
				}
				run.residualRisk.push(...parsed.residualRisk.map((risk) => `${group.id}: ${risk}`));
				for (const id of group.itemIds) if (!run.completedItemIds.includes(id)) run.completedItemIds.push(id);
				await appendReviewReceipt(run, { stage: "reviewer", groupId: group.id, outcome: "group_completed", details: { summary: parsed.summary, findings: parsed.findings.length, residualRisk: parsed.residualRisk } });
			} catch (error) {
				const classification = error instanceof ReviewStageError ? error.classification : "invalid_output";
				const reason = safeReason(error);
				for (const item of focus) this.addFailure(run, item.id, item.path, classification, reason);
				await appendReviewReceipt(run, { stage: "reviewer", groupId: group.id, outcome: "group_failed", details: { classification, reason } });
			}
		});
	}

	private async verifyGroups(ctx: ExtensionContext, run: ReviewRun, input: ReviewInput, items: ReviewInput["items"], control: ActiveReview, options: StartReviewOptions): Promise<void> {
		if (!run.workGraph) return;
		run.state = "verifying";
		run.updatedAt = new Date().toISOString();
		const itemById = new Map(items.map((item) => [item.id, item]));
		const groups = run.workGraph.groups.filter((group) => run.findings.some((finding) => finding.groupId === group.id));
		await appendReviewReceipt(run, { stage: "verifier", outcome: "stage_started", details: { groups: groups.length } });
		await parallelLimit(groups, run.budgets.maxConcurrency, async (group) => {
			const focus = group.itemIds.map((id) => itemById.get(id)!).filter(Boolean);
			const findings = run.findings.filter((finding) => finding.groupId === group.id);
			try {
				if (control.abort.signal.aborted) throw new ReviewStageError("Review cancelled", "cancelled");
				const severe = findings.some((finding) => finding.severity === "critical" || finding.severity === "significant");
				const tier: ReviewModelTier = run.profile === "fast" ? "fast" : run.profile === "thorough" || group.tier === "strong" || severe ? "strong" : "fast";
				const mode = tier === "strong" ? run.routing.strongMode : run.routing.fastMode;
				const route = await this.resolveModel(ctx, mode, tier);
				this.assertActive(control);
				const profile = reviewRoleProfile("verifier");
				const prompt = verifierPrompt(input, group, focus, findings, { background: options.background, authorityPacket: options.authorityPacket, reviewRoot: control.reviewRoot });
				this.assertPromptBudget(prompt, run, `verification group ${group.id}`);
				const record = await this.runRole(ctx, run, control, "verifier", group.id, route, profile, prompt, run.budgets.verifierMaxTurns);
				const parsed = parseVerifierOutput(record.result ?? "");
				exactIds(parsed.decisions.map((decision) => decision.findingId), findings.map((finding) => finding.id), `Verifier ${group.id}`);
				const decisionById = new Map(parsed.decisions.map((decision) => [decision.findingId, decision]));
				for (const finding of findings) finding.validation = decisionById.get(finding.id)!;
				run.residualRisk.push(...parsed.residualRisk.map((risk) => `${group.id} verification: ${risk}`));
				await appendReviewReceipt(run, { stage: "verifier", groupId: group.id, outcome: "group_verified", details: { decisions: parsed.decisions, residualRisk: parsed.residualRisk } });
			} catch (error) {
				const classification = error instanceof ReviewStageError ? error.classification : "invalid_output";
				const reason = safeReason(error);
				for (const finding of findings) finding.validation = { status: "retained_unresolved", reason: "Verification did not complete", evidence: reason };
				for (const item of focus) {
					run.completedItemIds = run.completedItemIds.filter((id) => id !== item.id);
					this.addFailure(run, item.id, item.path, classification, `Verification failed: ${reason}`);
				}
				await appendReviewReceipt(run, { stage: "verifier", groupId: group.id, outcome: "group_failed", details: { classification, reason } });
			}
		});
	}

	private async runRole(
		ctx: ExtensionContext,
		run: ReviewRun,
		control: ActiveReview,
		stage: ReviewAgentReceipt["stage"],
		groupId: string | undefined,
		route: ResolvedReviewModel,
		profile: ReturnType<typeof reviewRoleProfile>,
		prompt: string,
		maxTurns: number,
	) {
		this.assertActive(control);
		const service = this.getService();
		if (!service) throw new ReviewStageError("Review requires apple-pi's subagent extension to be loaded first", "provider");
		const remainingMs = Math.max(1, run.budgets.timeoutSeconds * 1000 - (Date.now() - Date.parse(run.startedAt)));
		const timeout = AbortSignal.timeout(remainingMs);
		const signal = AbortSignal.any([control.abort.signal, timeout]);
		let activeId: string | undefined;
		let roleLiveTokens = 0;
		let record: Awaited<ReturnType<ManagedSubagentService["runFresh"]>>;
		try {
			record = await service.runFresh(ctx, {
				type: profile.config.name,
				description: groupId ? `Review ${stage}: ${groupId}` : `Review ${stage}: ${run.runId.slice(0, 8)}`,
				prompt,
				agentConfig: profile.config,
				model: route.model,
				maxTurns,
				maxTokens: Math.max(1, run.budgets.maxTokens - run.totalTokens - control.inflightTokens),
				thinkingLevel: route.thinkingLevel as never,
				cwd: control.reviewRoot,
				signal,
				toolPolicy: createReviewAuthorityPolicy(control.reviewRoot),
				onStarted: (agentId) => {
					activeId = agentId;
					control.activeAgentIds.add(agentId);
				},
				onAssistantUsage: (usage) => {
					const tokens = usage.input + usage.output + usage.cacheWrite;
					roleLiveTokens += tokens;
					control.inflightTokens += tokens;
					if (run.totalTokens + control.inflightTokens >= run.budgets.maxTokens) {
						control.budgetExceeded = true;
						control.abort.abort();
						for (const agentId of control.activeAgentIds) service.abort(agentId);
					}
				},
			});
		} finally {
			if (activeId) control.activeAgentIds.delete(activeId);
			control.inflightTokens = Math.max(0, control.inflightTokens - roleLiveTokens);
		}
		const tokens = getLifetimeTotal(record.lifetimeUsage);
		run.totalTokens += tokens;
		const agent: ReviewAgentReceipt = {
			stage,
			...(groupId && { groupId }),
			tier: route.tier,
			mode: route.mode,
			skillHash: profile.skillHash,
			provider: route.model.provider,
			model: route.model.id,
			agentId: record.id,
			...(record.sessionFile && { sessionFile: record.sessionFile }),
			status: record.status,
			usage: record.lifetimeUsage,
			compactions: record.compactionCount,
		};
		run.agents.push(agent);
		run.updatedAt = new Date().toISOString();
		await appendReviewReceipt(run, { stage, ...(groupId && { groupId }), outcome: record.status, details: agent });
		if (control.budgetExceeded || run.totalTokens >= run.budgets.maxTokens) {
			control.abort.abort();
			for (const agentId of control.activeAgentIds) service.abort(agentId);
			throw new ReviewStageError(`Review token budget exceeded: ${run.totalTokens}/${run.budgets.maxTokens}`, "budget");
		}
		if (record.compactionCount > 0) throw new ReviewStageError(`${stage} compacted and lost its curated fresh context`, "compacted");
		if (record.status === "steered" || record.status === "aborted") throw new ReviewStageError(`${stage} exceeded its turn budget`, "budget");
		if (record.status === "stopped") throw new ReviewStageError(control.stopRequested ? "Review stopped" : "Review agent stopped", control.stopRequested ? "cancelled" : "timeout");
		if (record.status === "error") throw new ReviewStageError(`${stage} failed: ${record.error ?? "unknown error"}`, "provider");
		return record;
	}

	private async resolveModel(ctx: ExtensionContext, mode: string, tier: ReviewModelTier): Promise<ResolvedReviewModel> {
		if (this.resolveModelOverride) return this.resolveModelOverride(ctx, mode, tier);
		const fallbackThinking = tier === "strong" ? "xhigh" : "high";
		const resolved = await resolveModelAndThinking(
			ctx.cwd,
			ctx.modelRegistry,
			ctx.model,
			fallbackThinking,
			{ mode },
			ctx.isProjectTrusted(),
		);
		if (!resolved.model) throw new ReviewStageError(`No model is available for review mode ${mode}`, "provider");
		return { model: resolved.model, thinkingLevel: resolved.thinkingLevel, mode, tier };
	}

	private assertActive(control: ActiveReview): void {
		if (control.budgetExceeded) throw new ReviewStageError("Review token budget reached", "budget");
		if (control.stopRequested || control.abort.signal.aborted) throw new ReviewStageError("Review stopped", "cancelled");
	}

	private assertPromptBudget(prompt: string, run: ReviewRun, label: string): void {
		const bytes = Buffer.byteLength(prompt);
		if (bytes > run.budgets.maxPromptBytes) {
			throw new ReviewStageError(`${label} prompt is ${bytes} bytes; maximum is ${run.budgets.maxPromptBytes}`, "budget");
		}
	}

	private addFailure(
		run: ReviewRun,
		itemId: string,
		path: string,
		classification: ReviewCoverageFailure["classification"],
		reason: string,
	): void {
		if (run.failures.some((failure) => failure.itemId === itemId)) return;
		run.failures.push({ itemId, path, classification, reason: safeReason(reason) });
	}

	private deriveTerminalState(run: ReviewRun): void {
		const completed = new Set(run.completedItemIds);
		for (const failure of run.failures) completed.delete(failure.itemId);
		run.completedItemIds = [...completed];
		if (run.completedItemIds.length === run.selected.length && run.failures.length === 0) {
			run.state = "complete";
			run.lastOutcome = "Every selected review item completed and every emitted finding was verified";
		} else if (run.completedItemIds.length > 0) {
			run.state = "partial";
			run.lastOutcome = `${run.completedItemIds.length}/${run.selected.length} selected review items completed`;
		} else {
			run.state = "failed";
			run.lastOutcome = `No selected review item completed (${run.failures.length} failed)`;
		}
	}

	private assertExecutionContext(ctx: ExtensionContext): void {
		if (!ctx.isProjectTrusted()) throw new Error("Review execution requires a trusted project");
		if (!ctx.model) throw new Error("Review execution requires an active model");
	}
}

export function summarizeReviewRun(run: ReviewRun): string {
	const visible = run.findings.filter((finding) => finding.validation.status !== "rejected");
	const severity = (value: string) => visible.filter((finding) => finding.severity === value).length;
	return [
		`Run: ${run.runId}`,
		`Root: ${run.projectRoot}`,
		`State: ${run.state}`,
		`Source: ${run.source.mode}`,
		`Profile: ${run.profile}`,
		`Coverage: ${run.completedItemIds.length}/${run.selected.length} completed, ${run.failures.length} failed, ${run.waived.length} waived`,
		`Findings: ${visible.length} (critical ${severity("critical")}, significant ${severity("significant")}, minor ${severity("minor")}, nit ${severity("nit")})`,
		`Tokens: ${run.totalTokens}/${run.budgets.maxTokens}`,
		...(run.lastOutcome ? [`Outcome: ${run.lastOutcome}`] : []),
		...visible.slice(0, 20).flatMap((finding) => [
			`- [${finding.severity}/${finding.validation.status}] ${finding.path}${finding.startLine ? `:${finding.startLine}` : ""} — ${finding.summary}`,
			`  ${finding.impact}`,
		]),
		...(visible.length > 20 ? [`- … ${visible.length - 20} more finding(s) in the structured result`] : []),
		`Receipt: ${reviewReceiptPath(run.projectRoot, run.runId)}`,
	].join("\n");
}
