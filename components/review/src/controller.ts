import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { Model } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveModelAndThinking } from "../../mode-utils.js";
import { getManagedSubagentService, type ManagedSubagentService } from "../../subagents/src/service.js";
import { buildAgentPrompt } from "../../subagents/src/prompts.js";
import { getLifetimeTotal } from "../../subagents/src/usage.js";
import { createReviewAuthorityPolicy } from "./authority-policy.js";
import { deriveReviewBudgets, deriveRoleEnvelope, reviewShapeFrom } from "./policy.js";
import {
	assertReviewInputUnchanged,
	materializeReviewTree,
	previewReviewInput,
	resolveReviewTargetRoot,
	reviewRepositoryRoot,
	ReviewInputError,
} from "./git.js";
import { activeReviewLease, acquireReviewLease } from "./lease.js";
import { resolveReviewAnchor } from "./location.js";
import { appendReviewReceipt, listReviewRunSummaries, loadReviewRun, reviewReceiptPath } from "./receipts.js";
import {
	createReviewResultTool,
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
	ReviewRoleEnvelope,
	ReviewRun,
	ReviewTerminalCause,
	ReviewRunSummary,
	ReviewSource,
	StartReviewOptions,
} from "./types.js";
import { compileReviewWorkGraph, ReviewGraphError } from "./work-graph.js";

/** Balanced package policy retained for internal tests and status rendering. */
export const DEFAULT_REVIEW_BUDGETS: ReviewBudgets = deriveReviewBudgets("balanced", {
	selectedItems: 3,
	diffBytes: 0,
	binaryWaivers: 0,
});

export const DEFAULT_REVIEW_ROUTING: ReviewModelRouting = {
	plannerMode: "review-planner",
	fastMode: "review-fast",
	strongMode: "review-strong",
};

const TERMINAL = new Set(["complete", "partial", "failed", "skipped", "stopped", "workspace_conflict", "error"]);

/** Mirrors the managed runner's complete replace-mode system-prompt rendering. */
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
	budgetExceeded: boolean;
	externalCancelled: boolean;
	inflightTokens: number;
	/** Capacity atomically reserved for roles that have been admitted but not settled. */
	reservedTokens: number;
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

	async run(
		ctx: ExtensionContext,
		source: ReviewSource,
		options: StartReviewOptions = {},
		signal?: AbortSignal,
	): Promise<ReviewRun> {
		this.assertExecutionContext(ctx);
		const preview = previewReviewInput(resolveReviewTargetRoot(ctx.cwd, options.root), source);
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
			budgetExceeded: false,
			externalCancelled: false,
			inflightTokens: 0,
			reservedTokens: 0,
			run,
			reviewRoot: run.projectRoot,
			cleanupReviewRoot: () => {},
			releaseLease,
			settled,
			resolveSettled,
		};
		this.active.set(run.runId, control);
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
		};
		try {
			const tree = materializeReviewTree(input);
			control.reviewRoot = tree.root;
			control.cleanupReviewRoot = tree.cleanup;
			await this.plan(ctx, run, input, preview.reviewable, control, options);
			if (control.stopRequested || control.abort.signal.aborted)
				throw new ReviewStageError("Review stopped", "cancelled");
			assertReviewInputUnchanged(input);
			await this.reviewGroups(ctx, run, input, preview.reviewable, control, options);
			if (control.stopRequested) throw new ReviewStageError("Review stopped", "cancelled");
			assertReviewInputUnchanged(input);
			await this.verifyGroups(ctx, run, input, preview.reviewable, control, options);
			assertReviewInputUnchanged(input);
			if (control.stopRequested) {
				run.state = "stopped";
				run.terminalCause = "operator_stop";
			} else this.deriveTerminalState(run);
		} catch (error) {
			const cause = this.terminalCause(error, control);
			run.terminalCause = cause;
			if (cause === "aggregate_token_ceiling") {
				run.state = run.completedItemIds.length > 0 ? "partial" : "failed";
				run.lastOutcome = `Review aggregate token ceiling reached: ${run.totalTokens}/${run.budgets.maxTokens}`;
			} else if (cause === "operator_stop" || cause === "external_cancellation") {
				run.state = "stopped";
				run.lastOutcome = cause === "operator_stop" ? "Stopped by the operator" : "Cancelled by the caller";
			} else if (cause === "workspace_conflict") {
				run.state = "workspace_conflict";
				run.lastOutcome = safeReason(error);
			} else {
				const reason = safeReason(error);
				if (!run.workGraph) {
					const classification: ReviewCoverageFailure["classification"] =
						error instanceof ReviewGraphError ? "planner" : this.failureClassification(cause);
					for (const selected of run.selected) this.addFailure(run, selected.id, selected.path, classification, reason);
				}
				run.state = run.completedItemIds.length > 0 ? "partial" : "failed";
				run.lastOutcome = reason;
			}
		} finally {
			signal?.removeEventListener("abort", onExternalAbort);
		}
		run.updatedAt = new Date().toISOString();
		try {
			await appendReviewReceipt(run, {
				stage: "finalize",
				outcome: run.state,
				details: { completed: run.completedItemIds.length, failed: run.failures.length, findings: run.findings.length },
			});
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

	private async plan(
		ctx: ExtensionContext,
		run: ReviewRun,
		input: ReviewInput,
		items: ReviewInput["items"],
		control: ActiveReview,
		options: StartReviewOptions,
	): Promise<void> {
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
		const roleRun = await this.runRole(ctx, run, control, "planner", undefined, route, profile, prompt);
		const parsed = parsePlannerOutput(roleRun.submission);
		run.workGraph = compileReviewWorkGraph(parsed, items, run.profile, run.budgets.maxGroups);
		run.updatedAt = new Date().toISOString();
		await appendReviewReceipt(run, { stage: "planner", outcome: "graph_sealed", details: run.workGraph });
	}

	private async reviewGroups(
		ctx: ExtensionContext,
		run: ReviewRun,
		input: ReviewInput,
		items: ReviewInput["items"],
		control: ActiveReview,
		options: StartReviewOptions,
	): Promise<void> {
		if (!run.workGraph) throw new ReviewStageError("Review graph is missing", "planner");
		run.state = "reviewing";
		run.updatedAt = new Date().toISOString();
		await appendReviewReceipt(run, {
			stage: "reviewer",
			outcome: "stage_started",
			details: { groups: run.workGraph.groups.length },
		});
		const itemById = new Map(items.map((item) => [item.id, item]));
		await parallelLimit(run.workGraph.groups, run.budgets.maxConcurrency, async (group) => {
			const focus = group.itemIds.map((id) => itemById.get(id)!).filter(Boolean);
			try {
				if (control.abort.signal.aborted) throw new ReviewStageError("Review cancelled", "cancelled");
				const mode = group.tier === "strong" ? run.routing.strongMode : run.routing.fastMode;
				const route = await this.resolveModel(ctx, mode, group.tier);
				this.assertActive(control);
				const profile = reviewRoleProfile("reviewer");
				const prompt = reviewerPrompt(input, group, focus, items, {
					background: options.background,
					authorityPacket: options.authorityPacket,
					reviewRoot: control.reviewRoot,
				});
				const roleRun = await this.runRole(ctx, run, control, "reviewer", group.id, route, profile, prompt);
				const parsed = parseReviewerOutput(roleRun.submission);
				exactIds(parsed.reviewedItemIds, group.itemIds, `Reviewer ${group.id}`);
				const focusPaths = new Set(focus.map((item) => item.path));
				for (const [index, proposed] of parsed.findings.entries()) {
					if (!focusPaths.has(proposed.path))
						throw new ReviewStageError(
							`Reviewer ${group.id} filed a finding outside its focus: ${proposed.path}`,
							"invalid_output",
						);
					const candidates = focus.filter(
						(entry) =>
							entry.path === proposed.path &&
							(proposed.side === "old"
								? entry.status === "deleted" || entry.status === "renamed"
								: entry.status !== "deleted"),
					);
					if (candidates.length !== 1)
						throw new ReviewStageError(
							`Finding anchor path is not unique in group ${group.id}: ${proposed.path}`,
							"invalid_output",
						);
					const located = resolveReviewAnchor(run.projectRoot, candidates[0], proposed.anchor, proposed.side, {
						allowCurrentFile: input.source.mode === "workspace",
					});
					const finding: ReviewFinding = {
						...proposed,
						id: proposedFindingId(run.runId, group.id, index, proposed),
						groupId: group.id,
						...(located.startLine !== undefined && { startLine: located.startLine }),
						...(located.endLine !== undefined && { endLine: located.endLine }),
						anchorProvenance: located.provenance,
						anchorMatchCount: located.matchCount,
						validation: {
							status: "retained_unresolved",
							reason: "Awaiting independent verification",
							evidence: "Not yet verified",
						},
					};
					run.findings.push(finding);
				}
				run.residualRisk.push(...parsed.residualRisk.map((risk) => `${group.id}: ${risk}`));
				for (const id of group.itemIds) if (!run.completedItemIds.includes(id)) run.completedItemIds.push(id);
				await appendReviewReceipt(run, {
					stage: "reviewer",
					groupId: group.id,
					outcome: "group_completed",
					details: { summary: parsed.summary, findings: parsed.findings.length, residualRisk: parsed.residualRisk },
				});
			} catch (error) {
				const classification = error instanceof ReviewStageError ? error.classification : "invalid_output";
				const reason = safeReason(error);
				for (const item of focus) this.addFailure(run, item.id, item.path, classification, reason);
				await appendReviewReceipt(run, {
					stage: "reviewer",
					groupId: group.id,
					outcome: "group_failed",
					details: { classification, reason },
				});
			}
		});
		this.assertActive(control);
	}

	private async verifyGroups(
		ctx: ExtensionContext,
		run: ReviewRun,
		input: ReviewInput,
		items: ReviewInput["items"],
		control: ActiveReview,
		options: StartReviewOptions,
	): Promise<void> {
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
				const severe = findings.some(
					(finding) => finding.severity === "critical" || finding.severity === "significant",
				);
				const tier: ReviewModelTier =
					run.profile === "fast"
						? "fast"
						: run.profile === "thorough" || group.tier === "strong" || severe
							? "strong"
							: "fast";
				const mode = tier === "strong" ? run.routing.strongMode : run.routing.fastMode;
				const route = await this.resolveModel(ctx, mode, tier);
				this.assertActive(control);
				const profile = reviewRoleProfile("verifier");
				const prompt = verifierPrompt(input, group, focus, findings, {
					background: options.background,
					authorityPacket: options.authorityPacket,
					reviewRoot: control.reviewRoot,
				});
				const roleRun = await this.runRole(ctx, run, control, "verifier", group.id, route, profile, prompt);
				const parsed = parseVerifierOutput(roleRun.submission);
				exactIds(
					parsed.decisions.map((decision) => decision.findingId),
					findings.map((finding) => finding.id),
					`Verifier ${group.id}`,
				);
				const decisionById = new Map(parsed.decisions.map((decision) => [decision.findingId, decision]));
				for (const finding of findings) finding.validation = decisionById.get(finding.id)!;
				run.residualRisk.push(...parsed.residualRisk.map((risk) => `${group.id} verification: ${risk}`));
				await appendReviewReceipt(run, {
					stage: "verifier",
					groupId: group.id,
					outcome: "group_verified",
					details: { decisions: parsed.decisions, residualRisk: parsed.residualRisk },
				});
			} catch (error) {
				const classification = error instanceof ReviewStageError ? error.classification : "invalid_output";
				const reason = safeReason(error);
				for (const finding of findings)
					finding.validation = {
						status: "retained_unresolved",
						reason: "Verification did not complete",
						evidence: reason,
					};
				for (const item of focus) {
					run.completedItemIds = run.completedItemIds.filter((id) => id !== item.id);
					this.addFailure(run, item.id, item.path, classification, `Verification failed: ${reason}`);
				}
				await appendReviewReceipt(run, {
					stage: "verifier",
					groupId: group.id,
					outcome: "group_failed",
					details: { classification, reason },
				});
			}
		});
		this.assertActive(control);
	}

	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: one receipt-backed role lifecycle owns its cancellation and evidence transitions.
	private async runRole(
		ctx: ExtensionContext,
		run: ReviewRun,
		control: ActiveReview,
		stage: ReviewAgentReceipt["stage"],
		groupId: string | undefined,
		route: ResolvedReviewModel,
		profile: ReturnType<typeof reviewRoleProfile>,
		prompt: string,
	) {
		this.assertActive(control);
		const service = this.getService();
		if (!service)
			throw new ReviewStageError("Review requires apple-pi's subagent extension to be loaded first", "provider");
		const resultTool = createReviewResultTool(stage);
		let envelope: ReviewRoleEnvelope;
		try {
			envelope = deriveRoleEnvelope({
				stage,
				...(groupId && { groupId }),
				mode: route.mode,
				model: route.model,
				profile: run.profile,
				budgets: run.budgets,
				prompt,
				systemPrompt: renderReviewRoleSystemPrompt(profile.config, control.reviewRoot),
				resultTool: resultTool.tool,
				builtinToolNames: profile.config.builtinToolNames,
				elapsedSeconds: this.elapsedSeconds(run),
				// Actual settled/live usage determines a role's hard run-wide ceiling;
				// admission reservations only decide whether another launch fits.
				totalTokens: run.totalTokens + control.inflightTokens,
				reservedTokens: control.reservedTokens,
			});
		} catch (error) {
			throw new ReviewStageError(safeReason(error), "policy_input");
		}
		// Reserve expected request capacity before launch. The role itself receives
		// the remaining run-wide ceiling; live usage enforces that ceiling.
		control.reservedTokens += envelope.reservationTokens;
		run.policy?.envelopes.push(envelope);
		await appendReviewReceipt(run, {
			stage,
			...(groupId && { groupId }),
			outcome: "role_policy_resolved",
			details: envelope,
		});
		const timeout = AbortSignal.timeout(envelope.timeoutSeconds * 1000);
		let timedOut = false;
		timeout.addEventListener(
			"abort",
			() => {
				timedOut = true;
			},
			{ once: true },
		);
		const signal = AbortSignal.any([control.abort.signal, timeout]);
		let activeId: string | undefined;
		let roleLiveTokens = 0;
		let roleReservationRemaining = envelope.reservationTokens;
		let authorityDenied = false;
		let record: Awaited<ReturnType<ManagedSubagentService["runFresh"]>>;
		try {
			record = await service.runFresh(ctx, {
				type: profile.config.name,
				description: groupId ? `Review ${stage}: ${groupId}` : `Review ${stage}: ${run.runId.slice(0, 8)}`,
				prompt,
				agentConfig: profile.config,
				model: route.model,
				maxTurns: envelope.maxTurns,
				maxTokens: envelope.maxTokens,
				thinkingLevel: route.thinkingLevel as never,
				cwd: control.reviewRoot,
				signal,
				toolPolicy: createReviewAuthorityPolicy(control.reviewRoot, () => {
					authorityDenied = true;
				}),
				customTools: [resultTool.tool],
				toolExecution: "sequential",
				onStarted: (agentId) => {
					activeId = agentId;
					control.activeAgentIds.add(agentId);
				},
				onAssistantUsage: (usage) => {
					const tokens = usage.input + usage.output + usage.cacheWrite;
					roleLiveTokens += tokens;
					control.inflightTokens += tokens;
					// Consume this role's admission reservation as real usage arrives;
					// later launches must not count the same tokens twice.
					const reservedUsage = Math.min(roleReservationRemaining, tokens);
					roleReservationRemaining -= reservedUsage;
					control.reservedTokens = Math.max(0, control.reservedTokens - reservedUsage);
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
			control.reservedTokens = Math.max(0, control.reservedTokens - roleReservationRemaining);
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
			...(record.terminationCause && { terminationCause: record.terminationCause }),
			usage: record.lifetimeUsage,
			compactions: record.compactionCount,
		};
		run.agents.push(agent);
		run.updatedAt = new Date().toISOString();
		await appendReviewReceipt(run, { stage, ...(groupId && { groupId }), outcome: record.status, details: agent });
		if (authorityDenied)
			throw new ReviewStageError(`${stage} attempted to escape read-only review authority`, "authority");
		if (control.budgetExceeded || run.totalTokens >= run.budgets.maxTokens) {
			control.abort.abort();
			for (const agentId of control.activeAgentIds) service.abort(agentId);
			throw new ReviewStageError(`Review token budget exceeded: ${run.totalTokens}/${run.budgets.maxTokens}`, "budget");
		}
		if (record.compactionCount > 0)
			throw new ReviewStageError(`${stage} compacted and lost its curated fresh context`, "compacted");
		if (record.status === "steered" || record.status === "aborted") {
			const cause = record.terminationCause;
			throw new ReviewStageError(
				control.stopRequested
					? "Review stopped"
					: control.externalCancelled
						? "Review cancelled by the caller"
						: timedOut
							? `${stage} exceeded its elapsed-time envelope`
							: cause === "token_ceiling"
								? `${stage} reached its token envelope`
								: cause === "compaction"
									? `${stage} compacted`
									: `${stage} exceeded its turn envelope`,
				control.stopRequested || control.externalCancelled
					? "cancelled"
					: timedOut
						? "timeout"
						: cause === "compaction"
							? "compacted"
							: "budget",
				control.stopRequested
					? "operator_stop"
					: control.externalCancelled
						? "external_cancellation"
						: timedOut
							? "elapsed_time_ceiling"
							: cause === "token_ceiling"
								? "aggregate_token_ceiling"
								: cause === "compaction"
									? "compaction"
									: "role_turn_ceiling",
			);
		}
		if (record.status === "stopped") {
			const cause = record.terminationCause;
			throw new ReviewStageError(
				control.stopRequested
					? "Review stopped"
					: control.externalCancelled
						? "Review cancelled by the caller"
						: cause === "token_ceiling"
							? `${stage} reached its token envelope`
							: cause === "compaction"
								? `${stage} compacted`
								: timedOut
									? `${stage} exceeded its elapsed-time envelope`
									: "Review agent stopped",
				control.stopRequested || control.externalCancelled
					? "cancelled"
					: cause === "compaction"
						? "compacted"
						: cause === "token_ceiling"
							? "budget"
							: "timeout",
				control.stopRequested
					? "operator_stop"
					: control.externalCancelled
						? "external_cancellation"
						: cause === "token_ceiling"
							? "aggregate_token_ceiling"
							: cause === "compaction"
								? "compaction"
								: timedOut
									? "elapsed_time_ceiling"
									: "internal_error",
			);
		}
		if (record.status === "error")
			throw new ReviewStageError(`${stage} failed: ${record.error ?? "unknown error"}`, "provider");
		if (resultTool.calls() !== 1 || resultTool.value() === undefined) {
			throw new ReviewStageError(`${stage} did not submit exactly one typed result`, "invalid_output");
		}
		return { record, submission: resultTool.value() };
	}

	private terminalCause(error: unknown, control: ActiveReview): ReviewTerminalCause {
		if (control.budgetExceeded) return "aggregate_token_ceiling";
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
		if (control.budgetExceeded) throw new ReviewStageError("Review token budget reached", "budget");
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

	private elapsedSeconds(run: ReviewRun): number {
		return (Date.now() - Date.parse(run.startedAt)) / 1000;
	}

	private deriveTerminalState(run: ReviewRun): void {
		const completed = new Set(run.completedItemIds);
		for (const failure of run.failures) completed.delete(failure.itemId);
		run.completedItemIds = [...completed];
		if (run.completedItemIds.length === run.selected.length && run.failures.length === 0) {
			run.state = "complete";
			run.lastOutcome = "Every selected review item completed and every emitted finding was verified";
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
	return [
		`Run: ${run.runId}`,
		`Root: ${run.projectRoot}`,
		`State: ${run.state}`,
		`Source: ${run.source.mode}`,
		`Profile: ${run.profile}`,
		`Coverage: ${run.completedItemIds.length}/${run.selected.length} completed, ${run.failures.length} failed, ${run.waived.length} waived`,
		`Findings: ${visible.length} (critical ${severity("critical")}, significant ${severity("significant")}, minor ${severity("minor")}, nit ${severity("nit")})`,
		`Tokens: ${run.totalTokens}/${run.budgets.maxTokens}`,
		...(run.terminalCause ? [`Cause: ${run.terminalCause}`] : []),
		...(run.lastOutcome ? [`Outcome: ${run.lastOutcome}`] : []),
		...visible
			.slice(0, 20)
			.flatMap((finding) => [
				`- [${finding.severity}/${finding.validation.status}] ${finding.path}${finding.startLine ? `:${finding.startLine}` : ""} — ${finding.summary}`,
				`  ${finding.impact}`,
			]),
		...(visible.length > 20 ? [`- … ${visible.length - 20} more finding(s) in the structured result`] : []),
		`Receipt: ${reviewReceiptPath(run.projectRoot, run.runId)}`,
	].join("\n");
}
