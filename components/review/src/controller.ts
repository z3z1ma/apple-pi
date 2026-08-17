import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { ProgressChannel } from "../../operations/src/progress-channel.js";
import { resolveModelAndThinking } from "../../shared/src/mode-utils.js";
import { buildAgentPrompt } from "../../subagents/src/prompts.js";
import {
	getManagedSubagentService,
	type HarnessBoundedActivity,
	type ManagedSubagentService,
} from "../../subagents/src/service.js";
import { getLifetimeTotal } from "../../subagents/src/usage.js";
import { createReviewAuthorityPolicy } from "./authority-policy.js";
import { clusterFindings, extractSealedHunk } from "./evidence.js";
import {
	assertReviewInputUnchanged,
	materializeReviewTree,
	previewReviewInput,
	ReviewInputError,
	resolveReviewTargetRoot,
	reviewRepositoryRoot,
} from "./git.js";
import { acquireReviewLease, activeReviewLease } from "./lease.js";
import { groundReportedAnchor } from "./location.js";
import type { ReviewRunOwnership } from "./operations-service.js";
import { deriveReviewBudgets, deriveRoleEnvelope, reviewShapeFrom } from "./policy.js";
import { buildReviewProgressSnapshot } from "./progress.js";
import { appendReviewReceipt, listReviewRunSummaries, loadReviewRun, reviewReceiptPath } from "./receipts.js";
import {
	createMetaReviewTool,
	createOpenReviewTool,
	createReportTool,
	plannerPrompt,
	type ReviewToolCapture,
	reviewerPrompt,
	reviewRoleProfile,
	verifierPrompt,
} from "./roles.js";
import type {
	ReviewAgentReceipt,
	ReviewBudgets,
	ReviewCoverageFailure,
	ReviewFinding,
	ReviewFocus,
	ReviewFocusProgressState,
	ReviewInput,
	ReviewItem,
	ReviewMetaReview,
	ReviewModelRouting,
	ReviewModelTier,
	ReviewPartition,
	ReviewProgressSnapshot,
	ReviewReceiptStage,
	ReviewReport,
	ReviewRoleEnvelope,
	ReviewRoleProgressStatus,
	ReviewRun,
	ReviewRunSummary,
	ReviewSource,
	ReviewTerminalCause,
	StartReviewOptions,
} from "./types.js";
import {
	compileReviewCycle,
	focusIdentityKey,
	ReviewGraphError,
	reviewItemAliases,
	workGraphHash,
} from "./work-graph.js";

export const DEFAULT_REVIEW_BUDGETS: ReviewBudgets = deriveReviewBudgets("balanced", {
	selectedItems: 3,
	diffBytes: 0,
	binaryWaivers: 0,
});

export const DEFAULT_REVIEW_ROUTING: ReviewModelRouting = {
	plannerMode: "review-planner",
	fastMode: "review-routine",
	strongMode: "review-rigorous",
};

const TERMINAL = new Set(["complete", "partial", "failed", "skipped", "stopped", "workspace_conflict", "error"]);

function renderReviewRoleSystemPrompt(config: Parameters<typeof buildAgentPrompt>[0], cwd: string): string {
	let isGitRepo = false;
	let branch = "";
	try {
		isGitRepo =
			execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim() === "true";
	} catch {
		// Match detectEnv: an unavailable/non-repository Git probe renders the non-Git form.
	}
	if (isGitRepo) {
		try {
			branch = execFileSync("git", ["branch", "--show-current"], {
				cwd,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
			}).trim();
		} catch {
			branch = "unknown";
		}
	}
	return buildAgentPrompt(config, cwd, { isGitRepo, branch, platform: process.platform });
}

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
	externalCancelled: boolean;
	inflightTokens: number;
	failedFocusIds: Set<string>;
	succeededFocusIds: Set<string>;
	run: ReviewRun;
	reviewRoot: string;
	cleanupReviewRoot: () => void;
	releaseLease: () => void;
	settled: Promise<void>;
	resolveSettled: () => void;
	stage?: ReviewReceiptStage;
	cycleIndex: number;
	plannerStatus: ReviewRoleProgressStatus;
	verifierStatus: ReviewRoleProgressStatus;
	focusStates: Map<string, ReviewFocusProgressState>;
	focusActivity: Map<string, HarnessBoundedActivity>;
	plannerActivity?: HarnessBoundedActivity;
	verifierActivity?: HarnessBoundedActivity;
}

class ReviewStageError extends Error {
	constructor(
		message: string,
		readonly classification: ReviewCoverageFailure["classification"],
		readonly cause?: ReviewTerminalCause,
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

function normalizeRouting(input: Partial<ReviewModelRouting> = {}): ReviewModelRouting {
	const route = { ...DEFAULT_REVIEW_ROUTING, ...input };
	for (const [name, value] of Object.entries(route)) if (!value.trim()) throw new Error(`${name} must be non-empty`);
	return route;
}

function reportId(runId: string, focusId: string, index: number, report: ReviewReport): string {
	return sha256([runId, focusId, String(index), report.kind, report.path ?? "", report.what].join("\0")).slice(0, 24);
}

function itemsForReportedPath(items: Iterable<ReviewItem>, path: string, side: ReviewFinding["side"]): ReviewItem[] {
	return [...items].filter(
		(item) =>
			item.path === path &&
			(side === "old" ? item.status === "deleted" || item.status === "renamed" : item.status !== "deleted"),
	);
}

export class ReviewController {
	private readonly active = new Map<string, ActiveReview>();
	private readonly progress = new ProgressChannel<ReviewProgressSnapshot>();
	private readonly getService: () => ManagedSubagentService | undefined;
	private readonly resolveModelOverride?: ReviewControllerDependencies["resolveModel"];

	constructor(dependencies: ReviewControllerDependencies = {}) {
		this.getService = dependencies.getService ?? getManagedSubagentService;
		this.resolveModelOverride = dependencies.resolveModel;
	}

	preview(projectRoot: string, source: ReviewSource, options: StartReviewOptions = {}) {
		return previewReviewInput(projectRoot, source, options.paths);
	}

	async run(
		ctx: ExtensionContext,
		source: ReviewSource,
		options: StartReviewOptions = {},
		signal?: AbortSignal,
	): Promise<ReviewRun> {
		this.assertExecutionContext(ctx);
		const preview = previewReviewInput(resolveReviewTargetRoot(ctx.cwd, options.root), source, options.paths);
		const now = new Date().toISOString();
		const profile = options.profile ?? "balanced";
		const budgets = deriveReviewBudgets(
			profile,
			reviewShapeFrom(source, preview.reviewable, preview.waived.length),
			options.constraints,
		);
		const run: ReviewRun = {
			schemaVersion: 1,
			runId: randomUUID(),
			projectRoot: preview.projectRoot,
			source,
			profile,
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
			rawFindings: [],
			notes: [],
			metaReviews: [],
			residualRisk: [],
			totalTokens: 0,
			budgets,
			policy: {
				version: 1,
				profile,
				selectedItems: preview.reviewable.length,
				diffBytes: preview.reviewable.reduce((total, item) => total + Buffer.byteLength(item.diff), 0),
				binaryWaivers: preview.waived.length,
				budgets,
				envelopes: [],
			},
			routing: normalizeRouting(options.routing),
			agents: [],
		};
		if (run.selected.length === 0) {
			await appendReviewReceipt(run, {
				stage: "input",
				outcome: "input_sealed",
				details: { selected: 0, waived: run.waived.length, inputHash: run.inputHash },
			});
			run.state = "skipped";
			run.lastOutcome = run.waived.length
				? "No reviewable text changes; all selected changes were waived"
				: "No changes selected for review";
			run.updatedAt = new Date().toISOString();
			await appendReviewReceipt(run, { stage: "finalize", outcome: "skipped" });
			options.onStarted?.(run);
			this.publishStandalone(run, { stage: "finalize" });
			return run;
		}

		const releaseLease = acquireReviewLease(run.projectRoot, run.runId);
		try {
			await appendReviewReceipt(run, {
				stage: "input",
				outcome: "input_sealed",
				details: { selected: run.selected.length, waived: run.waived.length, inputHash: run.inputHash },
			});
		} catch (error) {
			releaseLease();
			throw error;
		}
		let resolveSettled!: () => void;
		const settled = new Promise<void>((resolve) => {
			resolveSettled = resolve;
		});
		const control: ActiveReview = {
			abort: new AbortController(),
			activeAgentIds: new Set(),
			stopRequested: false,
			externalCancelled: false,
			inflightTokens: 0,
			failedFocusIds: new Set(),
			succeededFocusIds: new Set(),
			run,
			reviewRoot: run.projectRoot,
			cleanupReviewRoot: () => {},
			releaseLease,
			settled,
			resolveSettled,
			stage: "input",
			cycleIndex: 0,
			plannerStatus: "idle",
			verifierStatus: "idle",
			focusStates: new Map(),
			focusActivity: new Map(),
		};
		this.active.set(run.runId, control);
		options.onStarted?.(run);
		this.emitProgress(control);
		const onExternalAbort = () => {
			control.externalCancelled = true;
			control.abort.abort();
		};
		signal?.addEventListener("abort", onExternalAbort, { once: true });
		if (signal?.aborted) {
			control.externalCancelled = true;
			control.abort.abort();
		}
		const input: ReviewInput = {
			projectRoot: preview.projectRoot,
			source,
			...(preview.resolvedBase && { resolvedBase: preview.resolvedBase }),
			...(preview.resolvedHead && { resolvedHead: preview.resolvedHead }),
			items: [...preview.reviewable, ...preview.waived.map(({ item }) => item)],
			inputHash: preview.inputHash,
			...(preview.paths?.length ? { paths: preview.paths } : {}),
		};
		try {
			const tree = materializeReviewTree(input);
			control.reviewRoot = tree.root;
			control.cleanupReviewRoot = tree.cleanup;
			await this.runCycles(ctx, run, input, preview.reviewable, control, options);
			if (control.stopRequested) throw new ReviewStageError("Review stopped", "cancelled");
			// Reseal is cycle-start plus this post-drain check. Reviewers may read a moving workspace during a cycle.
			assertReviewInputUnchanged(input);
			this.publishVisibleFindings(run);
			if (control.stopRequested) {
				run.state = "stopped";
				run.terminalCause = "operator_stop";
			} else this.deriveTerminalState(run);
		} catch (error) {
			this.settleCaughtRun(run, error, control);
		} finally {
			signal?.removeEventListener("abort", onExternalAbort);
		}
		run.updatedAt = new Date().toISOString();
		control.stage = "finalize";
		this.emitProgress(control);
		try {
			await appendReviewReceipt(run, {
				stage: "finalize",
				outcome: run.state,
				details: { completed: run.completedItemIds.length, failed: run.failures.length, findings: run.findings.length },
			});
			this.emitProgress(control);
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
		run.terminalCause = "operator_stop";
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

	subscribeProgress(listener: (snapshot: ReviewProgressSnapshot) => void): () => void {
		return this.progress.subscribe(listener);
	}

	liveProgress(): ReviewProgressSnapshot[] {
		return this.progress.list();
	}

	classifyOwnership(projectRootInput: string, runId: string): ReviewRunOwnership {
		const projectRoot = reviewRepositoryRoot(projectRootInput);
		const control = this.active.get(runId);
		if (control && control.run.projectRoot === projectRoot) return { kind: "owned" };
		const owner = activeReviewLease(projectRoot);
		if (owner && owner.runId === runId && owner.pid !== process.pid) {
			return { kind: "foreign", pid: owner.pid, ownerRunId: owner.runId };
		}
		return { kind: "stale" };
	}

	private emitProgress(control: ActiveReview): void {
		try {
			this.progress.publish(
				buildReviewProgressSnapshot(control.run, {
					sequence: this.progress.nextSequence(control.run.runId),
					...(control.stage && { stage: control.stage }),
					cycleIndex: control.cycleIndex,
					plannerStatus: control.plannerStatus,
					verifierStatus: control.verifierStatus,
					focusStates: control.focusStates,
					focusActivity: control.focusActivity,
					...(control.plannerActivity && { plannerActivity: control.plannerActivity }),
					...(control.verifierActivity && { verifierActivity: control.verifierActivity }),
				}),
			);
		} catch {
			// Projection faults must not alter the run.
		}
	}

	private publishStandalone(run: ReviewRun, live: { stage?: ReviewReceiptStage } = {}): void {
		try {
			this.progress.publish(
				buildReviewProgressSnapshot(run, {
					sequence: this.progress.nextSequence(run.runId),
					...live,
				}),
			);
		} catch {
			// Projection faults must not alter the run.
		}
	}

	private async runCycles(
		ctx: ExtensionContext,
		run: ReviewRun,
		input: ReviewInput,
		items: ReviewItem[],
		control: ActiveReview,
		options: StartReviewOptions,
	): Promise<void> {
		run.workGraph = { cycles: [], graphHash: workGraphHash([]) };
		const aliases = reviewItemAliases(items);
		for (let cycle = 1; cycle <= run.budgets.maxCycles; cycle++) {
			this.assertActive(control);
			// Next cycle starts only if this seal still matches. Mid-cycle workspace reads are live.
			assertReviewInputUnchanged(input);
			let opened: { partitions: ReviewPartition[]; focuses: ReviewFocus[] } | undefined;
			try {
				opened = await this.planCycle(ctx, run, input, items, control, options, cycle, aliases);
				if (opened.focuses.length === 0) {
					if (cycle === 1) throw new ReviewGraphError("Planner opened no reviews", "empty_graph");
					break;
				}
				await this.reviewCycle(ctx, run, input, items, control, options, opened.partitions, opened.focuses);
			} catch (error) {
				this.settleCycleCoverage(run, cycle, control);
				this.failUncovered(run);
				if (cycle > 1 && run.completedItemIds.length === run.selected.length && run.failures.length === 0) {
					run.residualRisk.push(`Later cycle stopped: ${safeReason(error)}`);
					break;
				}
				throw error;
			}
			this.settleCycleCoverage(run, cycle, control);
			run.workGraph.graphHash = workGraphHash(run.workGraph.cycles);
			const uncovered = run.selected.filter(
				(item) =>
					!run.completedItemIds.includes(item.id) && !run.failures.some((failure) => failure.itemId === item.id),
			);
			const lastMeta = run.metaReviews?.at(-1);
			const moreWork =
				uncovered.length > 0 || (lastMeta?.residuals.length ?? 0) > 0 || (lastMeta?.coverageGaps.length ?? 0) > 0;
			if (!moreWork) break;
		}
		this.failUncovered(run);
	}

	private async planCycle(
		ctx: ExtensionContext,
		run: ReviewRun,
		input: ReviewInput,
		items: ReviewItem[],
		control: ActiveReview,
		options: StartReviewOptions,
		cycle: number,
		aliases: Map<string, string>,
	): Promise<{ partitions: ReviewPartition[]; focuses: ReviewFocus[] }> {
		run.state = "planning";
		run.updatedAt = new Date().toISOString();
		control.stage = "planner";
		control.cycleIndex = cycle;
		control.plannerStatus = "running";
		this.emitProgress(control);
		const route = await this.resolveModel(ctx, run.routing.plannerMode, "fast");
		this.assertActive(control);
		const covered = new Set<string>();
		for (const record of run.workGraph?.cycles ?? []) {
			for (const partition of record.partitions) for (const id of partition.itemIds) covered.add(id);
		}
		const uncoveredAliases = items
			.filter((item) => run.selected.some((selected) => selected.id === item.id) && !covered.has(item.id))
			.map((item) => aliases.get(item.id) ?? item.path);
		const priorFocuses = (run.workGraph?.cycles ?? []).flatMap((record) =>
			record.focuses.map((focus) => ({
				cycle: record.index,
				title: focus.title,
				question: focus.question,
				files: focus.itemIds.map((id) => aliases.get(id) ?? id),
			})),
		);
		const priorKeys = new Set(
			(run.workGraph?.cycles ?? []).flatMap((record) =>
				record.focuses.map((focus) => focusIdentityKey(focus.itemIds, focus.question)),
			),
		);
		const prompt = plannerPrompt(input, items, {
			background: options.background,
			authorityPacket: options.authorityPacket,
			reviewRoot: control.reviewRoot,
			cycle,
			maxCycles: run.budgets.maxCycles,
			maxFocuses: run.budgets.maxFocuses,
			uncoveredAliases,
			priorFocuses,
			priorFindings: (run.rawFindings ?? [])
				.map((finding) => `- [${finding.severity}] ${finding.path}: ${finding.summary}`)
				.join("\n"),
			metaReview: run.metaReviews?.at(-1),
		});
		const opener = createOpenReviewTool();
		await this.runRole(
			ctx,
			run,
			control,
			"planner",
			undefined,
			undefined,
			cycle,
			route,
			reviewRoleProfile("planner"),
			prompt,
			opener,
			{
				requireCalls: cycle === 1,
			},
		);
		if (opener.calls() === 0) {
			control.plannerStatus = "completed";
			this.emitProgress(control);
			return { partitions: [], focuses: [] };
		}
		const compiled = compileReviewCycle(
			opener.values(),
			items,
			cycle,
			{ maxFocuses: run.budgets.maxFocuses },
			priorKeys,
		);
		run.workGraph ??= { cycles: [], graphHash: workGraphHash([]) };
		run.workGraph.cycles.push(compiled);
		run.workGraph.graphHash = workGraphHash(run.workGraph.cycles);
		await appendReviewReceipt(run, {
			stage: "planner",
			cycle,
			outcome: "graph_sealed",
			details: compiled,
		});
		control.plannerStatus = "completed";
		for (const focus of compiled.focuses) control.focusStates.set(focus.id, "queued");
		this.emitProgress(control);
		return compiled;
	}

	private async reviewCycle(
		ctx: ExtensionContext,
		run: ReviewRun,
		input: ReviewInput,
		items: ReviewItem[],
		control: ActiveReview,
		options: StartReviewOptions,
		partitions: ReviewPartition[],
		focuses: ReviewFocus[],
	): Promise<void> {
		run.state = "reviewing";
		run.updatedAt = new Date().toISOString();
		control.stage = "reviewer";
		control.cycleIndex = focuses[0]?.cycle ?? control.cycleIndex;
		for (const focus of focuses) if (!control.focusStates.has(focus.id)) control.focusStates.set(focus.id, "queued");
		this.emitProgress(control);
		const itemById = new Map(items.map((item) => [item.id, item]));
		const partitionById = new Map(partitions.map((partition) => [partition.id, partition]));
		await appendReviewReceipt(run, {
			stage: "reviewer",
			outcome: "focus_scheduler_started",
			details: {
				focuses: focuses.map((focus) => ({ id: focus.id, partitionId: focus.partitionId, itemIds: focus.itemIds })),
			},
		});
		const pending = [...focuses];
		const running = new Map<string, Promise<void>>();
		const launch = async (focus: ReviewFocus): Promise<void> => {
			control.focusStates.set(focus.id, "running");
			this.emitProgress(control);
			try {
				await this.reviewFocus(
					ctx,
					run,
					input,
					control,
					options,
					itemById,
					partitionById.get(focus.partitionId)!,
					focus,
				);
			} catch (error) {
				await this.failFocus(run, control, focus, error);
			} finally {
				running.delete(focus.id);
			}
		};
		const pump = (): void => {
			while (running.size < Math.min(run.budgets.maxConcurrency, focuses.length) && pending.length > 0) {
				const focus = pending.shift()!;
				running.set(focus.id, launch(focus));
			}
		};
		pump();
		while (running.size > 0) {
			await Promise.race(running.values());
			pump();
		}
		await this.verifyCycle(ctx, run, input, control, options, focuses[0]?.cycle ?? 1, focuses);
	}

	private async reviewFocus(
		ctx: ExtensionContext,
		run: ReviewRun,
		input: ReviewInput,
		control: ActiveReview,
		options: StartReviewOptions,
		itemById: Map<string, ReviewItem>,
		partition: ReviewPartition,
		focus: ReviewFocus,
	): Promise<void> {
		this.assertActive(control);
		const focusItems = focus.itemIds.map((id) => itemById.get(id)!);
		const allItems = [...itemById.values()];
		const route = await this.resolveModel(ctx, run.routing.fastMode, "fast");
		const prompt = reviewerPrompt(input, partition, focus, focusItems, allItems, {
			background: options.background,
			authorityPacket: options.authorityPacket,
			reviewRoot: control.reviewRoot,
		});
		const reporter = createReportTool(focusItems.map((item) => item.path));
		await this.runRole(
			ctx,
			run,
			control,
			"reviewer",
			partition.id,
			focus.id,
			focus.cycle,
			route,
			reviewRoleProfile("reviewer"),
			prompt,
			reporter,
			{ requireCalls: false },
		);
		const focusPaths = new Set(focusItems.map((item) => item.path));
		for (const [index, report] of reporter.values().entries()) {
			if (report.kind === "note") {
				run.notes ??= [];
				run.notes.push({
					id: reportId(run.runId, focus.id, index, report),
					cycle: focus.cycle,
					partitionId: partition.id,
					focusId: focus.id,
					summary: report.what,
					evidence: report.evidence ?? "",
				});
				continue;
			}
			if (!report.path || !focusPaths.has(report.path))
				throw new ReviewStageError(
					`Reviewer ${focus.id} filed a finding outside its focus: ${report.path}`,
					"invalid_output",
				);
			const candidates = itemsForReportedPath(focusItems, report.path, report.side ?? "new");
			if (candidates.length !== 1)
				throw new ReviewStageError(`Finding path is not unique in focus ${focus.id}: ${report.path}`, "invalid_output");
			const side = report.side ?? "new";
			const located = groundReportedAnchor(
				control.reviewRoot,
				candidates[0],
				report.evidence ?? "",
				side,
				{ startLine: report.startLine, endLine: report.endLine },
				{ allowCurrentFile: input.source.mode === "workspace" },
			);
			const extracted =
				located.provenance === "exact_file" || located.provenance === "exact_hunk"
					? extractSealedHunk(control.reviewRoot, candidates[0], side, located.startLine, located.endLine)
					: "";
			const evidence = extracted || report.evidence || report.what;
			run.rawFindings ??= [];
			run.rawFindings.push({
				id: reportId(run.runId, focus.id, index, report),
				cycle: focus.cycle,
				partitionId: partition.id,
				focusId: focus.id,
				severity: report.severity!,
				category: "other",
				summary: report.what,
				impact: report.why ?? report.what,
				evidence,
				path: report.path,
				anchor: evidence,
				side,
				...(report.suggestion && { suggestion: report.suggestion }),
				...(located.startLine !== undefined && { startLine: located.startLine }),
				...(located.endLine !== undefined && { endLine: located.endLine }),
				anchorProvenance: located.provenance,
				anchorMatchCount: located.matchCount,
				validation: { status: "retained_unresolved", reason: "Awaiting verification", evidence: "" },
			});
		}
		await appendReviewReceipt(run, {
			stage: "reviewer",
			partitionId: partition.id,
			focusId: focus.id,
			cycle: focus.cycle,
			outcome: "focus_reviewed",
			details: { reports: reporter.calls() },
		});
		control.succeededFocusIds.add(focus.id);
		control.focusStates.set(focus.id, "completed");
		this.emitProgress(control);
	}

	private async verifyCycle(
		ctx: ExtensionContext,
		run: ReviewRun,
		input: ReviewInput,
		control: ActiveReview,
		options: StartReviewOptions,
		cycle: number,
		focuses: ReviewFocus[],
	): Promise<void> {
		run.state = "verifying";
		run.updatedAt = new Date().toISOString();
		control.stage = "verifier";
		control.cycleIndex = cycle;
		control.verifierStatus = "running";
		this.emitProgress(control);
		const findings = (run.rawFindings ?? []).filter((finding) => finding.cycle === cycle);
		const notes = (run.notes ?? []).filter((note) => note.cycle === cycle);
		const clusters = clusterFindings(findings);
		const clusterByFinding = new Map(clusters.flatMap((cluster) => cluster.findingIds.map((id) => [id, cluster.id])));
		const route = await this.resolveModel(ctx, run.routing.strongMode, "strong");
		const prompt = verifierPrompt(
			input,
			cycle,
			focuses,
			findings.map((finding) => {
				const [item, extra] = itemsForReportedPath(input.items, finding.path, finding.side);
				return {
					id: finding.id,
					focusId: finding.focusId,
					path: finding.path,
					summary: finding.summary,
					impact: finding.impact,
					evidence: finding.evidence,
					...(finding.startLine !== undefined && { startLine: finding.startLine }),
					...(finding.endLine !== undefined && { endLine: finding.endLine }),
					provenance: finding.anchorProvenance,
					clusterId: clusterByFinding.get(finding.id),
					...(item && !extra
						? {
								hunk: extractSealedHunk(control.reviewRoot, item, finding.side, finding.startLine, finding.endLine),
							}
						: {}),
				};
			}),
			notes,
			clusters,
			{
				background: options.background,
				authorityPacket: options.authorityPacket,
				reviewRoot: control.reviewRoot,
			},
		);
		const meta = createMetaReviewTool();
		try {
			await this.runRole(
				ctx,
				run,
				control,
				"verifier",
				undefined,
				undefined,
				cycle,
				route,
				reviewRoleProfile("verifier"),
				prompt,
				meta,
				{ requireCalls: true },
			);
		} catch (error) {
			for (const finding of findings)
				finding.validation = {
					status: "retained_unresolved",
					reason: "Verification did not complete",
					evidence: safeReason(error),
				};
			throw error;
		}
		const parsed = meta.values()[0];
		const decided = new Set<string>();
		for (const decision of parsed.decisions) {
			const finding = findings.find((candidate) => candidate.id === decision.findingId);
			if (!finding)
				throw new ReviewStageError(`Verifier cited unknown finding ${decision.findingId}`, "invalid_output");
			if (decided.has(decision.findingId))
				throw new ReviewStageError(`Verifier repeated finding ${decision.findingId}`, "invalid_output");
			decided.add(decision.findingId);
			finding.validation = {
				status: decision.status,
				reason: decision.reason,
				evidence: decision.evidence,
				...(decision.invitedByAmbiguity && { invitedByAmbiguity: true }),
			};
		}
		if (findings.some((finding) => !decided.has(finding.id)))
			throw new ReviewStageError("Verifier did not decide every finding", "invalid_output");
		const clarityResiduals = parsed.decisions.flatMap((decision) => {
			if (decision.status !== "rejected" || !decision.invitedByAmbiguity) return [];
			const finding = findings.find((candidate) => candidate.id === decision.findingId);
			return finding ? [`Clarity: ${finding.path}: ${decision.reason}`] : [];
		});
		const residuals = [
			...parsed.residuals,
			...clarityResiduals.filter((residual) => !parsed.residuals.includes(residual)),
		];
		const metaReview: ReviewMetaReview = {
			cycle,
			sentiment: parsed.sentiment,
			compoundRisks: parsed.compoundRisks,
			residuals,
			coverageGaps: parsed.coverageGaps,
		};
		run.metaReviews ??= [];
		run.metaReviews.push(metaReview);
		const cycleRecord = run.workGraph?.cycles.find((record) => record.index === cycle);
		if (cycleRecord) cycleRecord.metaReview = metaReview;
		run.residualRisk.push(
			...residuals.map((risk) => `c${cycle}: ${risk}`),
			...parsed.coverageGaps.map((gap) => `c${cycle} gap: ${gap}`),
			...parsed.compoundRisks.map((risk) => `c${cycle} compound: ${risk}`),
		);
		await appendReviewReceipt(run, {
			stage: "verifier",
			cycle,
			outcome: "focus_verified",
			details: metaReview,
		});
		control.verifierStatus = "completed";
		this.emitProgress(control);
	}

	private async failFocus(run: ReviewRun, control: ActiveReview, focus: ReviewFocus, error: unknown): Promise<void> {
		const classification = error instanceof ReviewStageError ? error.classification : "invalid_output";
		const reason = safeReason(error);
		control.failedFocusIds.add(focus.id);
		control.focusStates.set(focus.id, "failed");
		this.emitProgress(control);
		await appendReviewReceipt(run, {
			stage: "reviewer",
			partitionId: focus.partitionId,
			focusId: focus.id,
			cycle: focus.cycle,
			outcome: "focus_failed",
			details: { classification, reason },
		});
	}

	private settleCycleCoverage(run: ReviewRun, cycle: number, control: ActiveReview): void {
		const sealed = run.workGraph?.cycles.find((record) => record.index === cycle);
		if (sealed) this.markCycleCoverage(run, sealed.focuses, control);
	}

	private markCycleCoverage(run: ReviewRun, focuses: ReviewFocus[], control: ActiveReview): void {
		const covering = new Map<string, ReviewFocus[]>();
		for (const focus of focuses) {
			for (const id of focus.itemIds) {
				const current = covering.get(id) ?? [];
				current.push(focus);
				covering.set(id, current);
			}
		}
		for (const [id, focusesForItem] of covering) {
			const anySucceeded = focusesForItem.some((focus) => control.succeededFocusIds.has(focus.id));
			if (anySucceeded) {
				if (!run.completedItemIds.includes(id)) run.completedItemIds.push(id);
				continue;
			}
			if (run.completedItemIds.includes(id)) {
				const failed = focusesForItem.filter((focus) => control.failedFocusIds.has(focus.id)).map((focus) => focus.id);
				if (failed.length) run.residualRisk.push(`Later focus ${failed.join(", ")} failed after coverage already held`);
				continue;
			}
			const selected = run.selected.find((item) => item.id === id);
			if (selected) this.addFailure(run, id, selected.path, "invalid_output", "Every covering focus failed");
		}
	}

	private failUncovered(run: ReviewRun): void {
		const assigned = new Set<string>();
		for (const cycle of run.workGraph?.cycles ?? []) {
			for (const partition of cycle.partitions) for (const id of partition.itemIds) assigned.add(id);
		}
		for (const selected of run.selected) {
			if (assigned.has(selected.id)) continue;
			if (run.completedItemIds.includes(selected.id) || run.failures.some((failure) => failure.itemId === selected.id))
				continue;
			this.addFailure(run, selected.id, selected.path, "planner", "Planner never opened a review covering this file");
		}
	}

	private publishVisibleFindings(run: ReviewRun): void {
		run.findings = [...(run.rawFindings ?? [])].sort((left, right) => {
			const path = left.path.localeCompare(right.path);
			if (path !== 0) return path;
			const line = (left.startLine ?? 0) - (right.startLine ?? 0);
			if (line !== 0) return line;
			return left.id.localeCompare(right.id);
		});
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one receipt-backed role lifecycle owns its cancellation and evidence transitions.
	private async runRole<T>(
		ctx: ExtensionContext,
		run: ReviewRun,
		control: ActiveReview,
		stage: ReviewAgentReceipt["stage"],
		partitionId: string | undefined,
		focusId: string | undefined,
		cycle: number | undefined,
		route: ResolvedReviewModel,
		profile: ReturnType<typeof reviewRoleProfile>,
		prompt: string,
		capture: ReviewToolCapture<T>,
		policy: { requireCalls: boolean },
	) {
		this.assertActive(control);
		const service = this.getService();
		if (!service)
			throw new ReviewStageError("Review requires apple-pi's subagent extension to be loaded first", "provider");
		const customTools: ToolDefinition[] = [capture.tool];
		let envelope: ReviewRoleEnvelope;
		try {
			envelope = deriveRoleEnvelope({
				stage,
				...(partitionId && { partitionId }),
				...(focusId && { focusId }),
				...(cycle !== undefined && { cycle }),
				mode: route.mode,
				model: route.model,
				profile: run.profile,
				budgets: run.budgets,
				prompt,
				systemPrompt: renderReviewRoleSystemPrompt(profile.config, control.reviewRoot),
				resultTool: capture.tool,
				customTools,
				builtinToolNames: profile.config.builtinToolNames,
			});
		} catch (error) {
			throw new ReviewStageError(safeReason(error), "policy_input");
		}
		run.policy?.envelopes.push(envelope);
		await appendReviewReceipt(run, {
			stage,
			...(partitionId && { partitionId }),
			...(focusId && { focusId }),
			...(cycle !== undefined && { cycle }),
			outcome: "role_policy_resolved",
			details: envelope,
		});
		const signal = control.abort.signal;
		let activeId: string | undefined;
		let roleLiveTokens = 0;
		let authorityDenied = false;
		let record: Awaited<ReturnType<ManagedSubagentService["runFresh"]>>;
		try {
			record = await service.runFresh(ctx, {
				type: profile.config.name,
				description: focusId ? `Review ${stage}: ${focusId}` : `Review ${stage}: ${run.runId.slice(0, 8)}`,
				prompt,
				agentConfig: profile.config,
				model: route.model,
				maxTurns: 0,
				thinkingLevel: (stage === "planner" || stage === "reviewer" ? "low" : route.thinkingLevel) as never,
				cwd: control.reviewRoot,
				signal,
				toolPolicy: createReviewAuthorityPolicy(control.reviewRoot, () => {
					authorityDenied = true;
				}),
				customTools,
				toolExecution: "sequential",
				onStarted: (agentId) => {
					activeId = agentId;
					control.activeAgentIds.add(agentId);
				},
				onAssistantUsage: (usage) => {
					const tokens = usage.input + usage.output + usage.cacheWrite;
					roleLiveTokens += tokens;
					control.inflightTokens += tokens;
				},
				onActivity: (activity) => {
					if (stage === "planner") control.plannerActivity = activity;
					else if (stage === "verifier") control.verifierActivity = activity;
					else if (focusId) control.focusActivity.set(focusId, activity);
					this.emitProgress(control);
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
			...(partitionId && { partitionId }),
			...(focusId && { focusId }),
			...(cycle !== undefined && { cycle }),
			tier: route.tier,
			mode: route.mode,
			skillHash: profile.skillHash,
			provider: route.model.provider,
			model: route.model.id,
			agentId: record.id,
			...(record.sessionFile && { sessionFile: record.sessionFile }),
			status: record.status,
			...(record.terminationCause && { terminationCause: record.terminationCause }),
			usage: record.lifetimeUsage,
			compactions: record.compactionCount,
		};
		run.agents.push(agent);
		run.updatedAt = new Date().toISOString();
		await appendReviewReceipt(run, {
			stage,
			...(partitionId && { partitionId }),
			...(focusId && { focusId }),
			...(cycle !== undefined && { cycle }),
			outcome: record.status,
			details: agent,
		});
		if (authorityDenied)
			throw new ReviewStageError(`${stage} attempted to escape read-only review authority`, "authority");
		if (record.compactionCount > 0)
			throw new ReviewStageError(`${stage} compacted and lost its curated fresh context`, "compacted");
		if (record.status === "steered" || record.status === "aborted") {
			const cause = record.terminationCause;
			throw new ReviewStageError(
				control.stopRequested
					? "Review stopped"
					: control.externalCancelled
						? "Review cancelled by the caller"
						: cause === "compaction"
							? `${stage} compacted`
							: `${stage} was aborted`,
				control.stopRequested || control.externalCancelled
					? "cancelled"
					: cause === "compaction"
						? "compacted"
						: "provider",
				control.stopRequested
					? "operator_stop"
					: control.externalCancelled
						? "external_cancellation"
						: cause === "compaction"
							? "compaction"
							: "provider_error",
			);
		}
		if (record.status === "stopped") {
			const cause = record.terminationCause;
			throw new ReviewStageError(
				control.stopRequested
					? "Review stopped"
					: control.externalCancelled
						? "Review cancelled by the caller"
						: cause === "compaction"
							? `${stage} compacted`
							: "Review agent stopped",
				control.stopRequested || control.externalCancelled
					? "cancelled"
					: cause === "compaction"
						? "compacted"
						: "unknown",
				control.stopRequested
					? "operator_stop"
					: control.externalCancelled
						? "external_cancellation"
						: cause === "compaction"
							? "compaction"
							: "internal_error",
			);
		}
		if (record.status === "error")
			throw new ReviewStageError(`${stage} failed: ${record.error ?? "unknown error"}`, "provider");
		if (policy.requireCalls && capture.calls() < 1)
			throw new ReviewStageError(`${stage} did not submit a typed result`, "invalid_output");
		return { record };
	}

	private terminalCause(error: unknown, control: ActiveReview): ReviewTerminalCause {
		if (control.stopRequested) return "operator_stop";
		if (control.externalCancelled) return "external_cancellation";
		if (error instanceof ReviewInputError) return "workspace_conflict";
		if (error instanceof ReviewGraphError) return "invalid_output";
		if (error instanceof ReviewStageError) {
			if (error.cause) return error.cause;
			switch (error.classification) {
				case "timeout":
					return "elapsed_time_ceiling";
				case "budget":
					return "role_turn_ceiling";
				case "compacted":
					return "compaction";
				case "provider":
					return "provider_error";
				case "invalid_output":
					return "invalid_output";
				case "authority":
					return "authority_denial";
				case "policy_input":
					return "policy_input";
				case "cancelled":
					return "external_cancellation";
				default:
					return "internal_error";
			}
		}
		return "internal_error";
	}

	private failureClassification(cause: ReviewTerminalCause): ReviewCoverageFailure["classification"] {
		switch (cause) {
			case "provider_error":
				return "provider";
			case "elapsed_time_ceiling":
				return "timeout";
			case "aggregate_token_ceiling":
			case "role_turn_ceiling":
				return "budget";
			case "compaction":
				return "compacted";
			case "invalid_output":
				return "invalid_output";
			case "authority_denial":
				return "authority";
			case "workspace_conflict":
				return "workspace";
			case "policy_input":
				return "policy_input";
			case "operator_stop":
			case "external_cancellation":
				return "cancelled";
			default:
				return "unknown";
		}
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
		if (control.stopRequested || control.abort.signal.aborted)
			throw new ReviewStageError("Review stopped", "cancelled");
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

	private causeFromFailures(failures: ReviewCoverageFailure[]): ReviewTerminalCause {
		const classifications = new Set(failures.map((failure) => failure.classification));
		if (classifications.has("authority")) return "authority_denial";
		if (classifications.has("workspace")) return "workspace_conflict";
		if (classifications.has("policy_input")) return "policy_input";
		if (classifications.has("invalid_output") || classifications.has("planner")) return "invalid_output";
		if (classifications.has("provider")) return "provider_error";
		if (classifications.has("timeout")) return "elapsed_time_ceiling";
		if (classifications.has("budget")) return "role_turn_ceiling";
		if (classifications.has("compacted")) return "compaction";
		if (classifications.has("cancelled")) return "external_cancellation";
		return "internal_error";
	}

	private settleCaughtRun(run: ReviewRun, error: unknown, control: ActiveReview): void {
		this.publishVisibleFindings(run);
		const cause = this.terminalCause(error, control);
		run.terminalCause = cause;
		if (cause === "operator_stop" || cause === "external_cancellation") {
			run.state = "stopped";
			run.lastOutcome = cause === "operator_stop" ? "Stopped by the operator" : "Cancelled by the caller";
			return;
		}
		if (cause === "workspace_conflict") {
			run.state = "workspace_conflict";
			run.lastOutcome = safeReason(error);
			return;
		}
		const reason = safeReason(error);
		if (!run.workGraph?.cycles.length) {
			const classification: ReviewCoverageFailure["classification"] =
				error instanceof ReviewGraphError ? "planner" : this.failureClassification(cause);
			for (const selected of run.selected) this.addFailure(run, selected.id, selected.path, classification, reason);
		}
		const covered = run.completedItemIds.length === run.selected.length && run.failures.length === 0;
		const firstCycleVerified = run.metaReviews?.some((meta) => meta.cycle === 1);
		if (covered && firstCycleVerified) {
			run.state = "complete";
			run.terminalCause = undefined;
			run.residualRisk.push(`Coverage held after a later stage stopped: ${reason}`);
			run.lastOutcome = run.metaReviews?.at(-1)?.sentiment ?? "Review complete.";
			return;
		}
		if (covered) {
			run.state = "error";
			run.lastOutcome = reason;
			return;
		}
		run.state = run.completedItemIds.length > 0 ? "partial" : "failed";
		run.lastOutcome = reason;
	}

	private deriveTerminalState(run: ReviewRun): void {
		const completed = new Set(run.completedItemIds);
		for (const failure of run.failures) completed.delete(failure.itemId);
		run.completedItemIds = [...completed];
		if (run.completedItemIds.length === run.selected.length && run.failures.length === 0) {
			run.state = "complete";
			run.lastOutcome = run.metaReviews?.at(-1)?.sentiment
				? `Review complete. ${run.metaReviews.at(-1)!.sentiment}`
				: "Every selected review item completed and every emitted finding was verified";
			return;
		}
		run.terminalCause = this.causeFromFailures(run.failures);
		if (run.completedItemIds.length > 0) {
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
	const grouped = new Map<string, typeof visible>();
	for (const finding of visible) {
		const bucket = grouped.get(finding.path) ?? [];
		bucket.push(finding);
		grouped.set(finding.path, bucket);
	}
	const meta = run.metaReviews?.at(-1);
	return [
		`Run: ${run.runId}`,
		`Root: ${run.projectRoot}`,
		`State: ${run.state}`,
		`Source: ${run.source.mode}`,
		`Profile: ${run.profile}`,
		`Cycles: ${run.workGraph?.cycles.length ?? 0}/${run.budgets.maxCycles}`,
		`Coverage: ${run.completedItemIds.length}/${run.selected.length} completed, ${run.failures.length} failed, ${run.waived.length} waived`,
		`Findings: ${visible.length} (critical ${severity("critical")}, significant ${severity("significant")}, minor ${severity("minor")}, nit ${severity("nit")})`,
		`Tokens: ${run.totalTokens}`,
		...(meta ? [`Meta: ${meta.sentiment}`] : []),
		...(run.terminalCause ? [`Cause: ${run.terminalCause}`] : []),
		...(run.lastOutcome ? [`Outcome: ${run.lastOutcome}`] : []),
		...[...grouped.entries()].flatMap(([path, findings]) => [
			`${path}:`,
			...findings.map(
				(finding) =>
					`  - [${finding.severity}/${finding.validation.status}]${finding.startLine ? `:${finding.startLine}` : ""} ${finding.summary}`,
			),
		]),
		`Receipt: ${reviewReceiptPath(run.projectRoot, run.runId)}`,
	].join("\n");
}
