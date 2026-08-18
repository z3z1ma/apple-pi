import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { withSidecarUsageContext } from "../../../shared/src/sidecar-usage.js";
import { CONSOLIDATION_ABORT_REASON } from "../abort.js";
import { CuratorStreamError, runCurator } from "../agents/curator/agent.js";
import { type Config, resolveObserverChunkMaxTokens } from "../config.js";
import { debugLog, withDebugLogContext } from "../debug-log.js";
import { isStaleExtensionCtxError, type ResolveResult, type Runtime } from "../runtime.js";
import { serializeSourceAddressedBranchEntries } from "../serialize.js";
import {
	buildObservationsDroppedData,
	buildObservationsRecordedData,
	buildReflectionsRecordedData,
	buildReflectionsRetiredData,
	type Entry,
	foldLedger,
	isSourceEntry,
	latestCoverageIndex,
	latestCoverageMarkerId,
	OM_OBSERVATIONS_DROPPED,
	OM_OBSERVATIONS_RECORDED,
	OM_REFLECTIONS_RECORDED,
	OM_REFLECTIONS_RETIRED,
	rawTokensSinceObservationCoverage,
	realTokensSinceAnchor,
	realTokensSinceCoverageIndex,
} from "../session-ledger/index.js";

type ResolvedModel = Extract<ResolveResult, { ok: true }>;

type ConsolidationCtx = {
	cwd: string;
	projectTrusted?: boolean;
	isProjectTrusted?: () => boolean;
	hasUI: boolean;
	ui?: { notify: (message: string, type?: "warning" | "info" | "error") => void };
	model: unknown;
	modelRegistry: any;
	getContextUsage?: () => { tokens?: number | null; contextWindow?: number } | undefined;
	sessionManager: {
		getBranch: () => unknown;
		getSessionId?: () => string;
		getSessionFile?: () => string | undefined;
	};
};

function sourceEntriesAfter(entries: Entry[], index: number): Entry[] {
	return entries.slice(index + 1).filter(isSourceEntry);
}

function appendEntry(pi: ExtensionAPI, runtime: Runtime, customType: string, data: unknown): boolean {
	if (runtime.disposed) return false;
	try {
		pi.appendEntry(customType, data);
		return true;
	} catch (error) {
		if (isStaleExtensionCtxError(error)) {
			runtime.dispose();
			return false;
		}
		throw error;
	}
}

function realContextTokens(ctx: ConsolidationCtx): number | undefined {
	const usage = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : undefined;
	const tokens = usage?.tokens;
	return typeof tokens === "number" && Number.isFinite(tokens) ? tokens : undefined;
}

function tokensSinceObservationCoverage(entries: Entry[], currentTokens: number | undefined): number {
	const real =
		currentTokens !== undefined ? realTokensSinceAnchor(entries, OM_OBSERVATIONS_RECORDED, currentTokens) : undefined;
	return real !== undefined ? real : rawTokensSinceObservationCoverage(entries);
}

function observationDue(entries: Entry[], currentTokens: number | undefined, threshold: number): boolean {
	if (currentTokens !== undefined) {
		const real = realTokensSinceCoverageIndex(
			entries,
			latestCoverageIndex(entries, OM_OBSERVATIONS_RECORDED),
			currentTokens,
		);
		if (real !== undefined) return real >= threshold;
	}
	return rawTokensSinceObservationCoverage(entries) >= threshold;
}

function observerEmptyBackoffActive(
	runtime: Runtime,
	sessionIdentity: string | undefined,
	coverageId: string | undefined,
	tokens: number,
	observeAfterTokens: number,
): boolean {
	const backoff = runtime.observerEmptyBackoff;
	if (!backoff) return false;
	if (
		sessionIdentity !== backoff.sessionIdentity ||
		coverageId !== backoff.coverageId ||
		tokens >= backoff.tokensAtEmpty + observeAfterTokens
	) {
		runtime.observerEmptyBackoff = undefined;
		return false;
	}
	return true;
}

function curationDue(
	entries: Entry[],
	config: Config,
	runtime: Runtime,
	sessionIdentity: string | undefined,
	currentTokens: number | undefined,
): boolean {
	if (!observationDue(entries, currentTokens, config.observeAfterTokens)) return false;
	const tokens = tokensSinceObservationCoverage(entries, currentTokens);
	const coverageId = latestCoverageMarkerId(entries, OM_OBSERVATIONS_RECORDED);
	return !observerEmptyBackoffActive(runtime, sessionIdentity, coverageId, tokens, config.observeAfterTokens);
}

function shouldNotifyWorker(config: Config, ctx: ConsolidationCtx): boolean {
	return config.showWorkerNotifications && ctx.hasUI;
}

function makeModelResolver(runtime: Runtime, ctx: ConsolidationCtx): () => Promise<ResolvedModel | undefined> {
	let cached: ResolveResult | undefined;
	return async () => {
		cached ??= await runtime.resolveModel({
			cwd: ctx.cwd,
			projectTrusted: ctx.projectTrusted,
			model: ctx.model,
			modelRegistry: ctx.modelRegistry,
			hasUI: ctx.hasUI,
			ui: ctx.ui,
		});
		if (cached.ok) {
			runtime.resolveFailureNotified = false;
			return cached;
		}
		debugLog("curator.model_unavailable", { reason: cached.reason });
		if (!runtime.resolveFailureNotified && ctx.hasUI && ctx.ui) {
			ctx.ui.notify(`Observational memory: curator skipped — ${cached.reason}`, "warning");
			runtime.resolveFailureNotified = true;
		}
		return undefined;
	};
}

export function registerConsolidationTrigger(pi: ExtensionAPI, runtime: Runtime): void {
	pi.on("turn_end", (_event, ctx) => {
		maybeLaunchConsolidation(pi, runtime, ctx);
	});
	pi.on("agent_start", () => {
		runtime.abortConsolidation(CONSOLIDATION_ABORT_REASON.userTurn);
	});
	pi.on("session_shutdown", () => {
		runtime.dispose();
	});
}

function debugSessionMetadata(ctx: ConsolidationCtx): { sessionId?: string; sessionFile?: string } {
	try {
		return {
			sessionId: ctx.sessionManager.getSessionId?.(),
			sessionFile: ctx.sessionManager.getSessionFile?.(),
		};
	} catch {
		return {};
	}
}

function maybeLaunchConsolidation(pi: ExtensionAPI, runtime: Runtime, ctx: ConsolidationCtx): void {
	if (runtime.disposed) return;
	const config = runtime.ensureConfig(ctx.cwd);
	if (config.passive === true) return;
	if (runtime.consolidationInFlight) return;

	const entries = ctx.sessionManager.getBranch() as Entry[];
	const sessionMetadata = debugSessionMetadata(ctx);
	const sessionIdentity = sessionMetadata.sessionId ?? sessionMetadata.sessionFile;
	if (!curationDue(entries, config, runtime, sessionIdentity, realContextTokens(ctx))) return;

	const runId = `consolidation-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;
	const consolidationCtx: ConsolidationCtx = {
		cwd: ctx.cwd,
		projectTrusted: typeof ctx.isProjectTrusted === "function" ? ctx.isProjectTrusted() : false,
		hasUI: ctx.hasUI,
		ui: ctx.ui,
		model: ctx.model,
		modelRegistry: ctx.modelRegistry,
		getContextUsage: ctx.getContextUsage,
		sessionManager: ctx.sessionManager,
	};
	void runtime.launchConsolidationTask(ctx, async () =>
		withDebugLogContext(
			{
				enabled: config.debugLog === true,
				cwd: ctx.cwd,
				...sessionMetadata,
				runId,
			},
			() =>
				withSidecarUsageContext({ sessionId: sessionMetadata.sessionId }, async () => {
					await runConsolidationPipeline(pi, runtime, consolidationCtx, config);
				}),
		),
	);
}

export async function runConsolidationPipeline(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: ConsolidationCtx,
	config: Config = runtime.config,
): Promise<void> {
	if (runtime.disposed) return;
	runtime.consolidationPhase = "curator";
	try {
		await runCuratorStage(pi, runtime, ctx, makeModelResolver(runtime, ctx), config);
	} catch (error) {
		debugLog("curator.error", { errorMessage: runtime.recordConsolidationStageError(ctx, "curator", error) });
	}
}

async function runCuratorStage(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: ConsolidationCtx,
	resolveModel: () => Promise<ResolvedModel | undefined>,
	config: Config,
): Promise<void> {
	if (runtime.disposed) return;
	const entries = ctx.sessionManager.getBranch() as Entry[];
	const currentTokens = realContextTokens(ctx);
	const tokens = tokensSinceObservationCoverage(entries, currentTokens);
	if (tokens < config.observeAfterTokens) return;

	const sessionMetadata = debugSessionMetadata(ctx);
	const sessionIdentity = sessionMetadata.sessionId ?? sessionMetadata.sessionFile;
	const coverageId = latestCoverageMarkerId(entries, OM_OBSERVATIONS_RECORDED);
	if (observerEmptyBackoffActive(runtime, sessionIdentity, coverageId, tokens, config.observeAfterTokens)) {
		debugLog("curator.empty_backoff", {
			tokens,
			resumeAtTokens: (runtime.observerEmptyBackoff?.tokensAtEmpty ?? tokens) + config.observeAfterTokens,
		});
		return;
	}

	const resolved = await resolveModel();
	if (runtime.disposed) return;
	if (!resolved) return;

	const lastCoverageIdx = latestCoverageIndex(entries, OM_OBSERVATIONS_RECORDED);
	const backlogEntries = sourceEntriesAfter(entries, lastCoverageIdx);
	const contextWindow = (resolved.model as { contextWindow?: number }).contextWindow;
	const maxChunkTokens = resolveObserverChunkMaxTokens(config, contextWindow);
	const {
		text: chunk,
		sourceEntryIds,
		estimatedTokens: chunkTokens,
		truncatedSourceEntryIds,
	} = serializeSourceAddressedBranchEntries(backlogEntries, { maxTokens: maxChunkTokens });
	if (!chunk.trim() || sourceEntryIds.length === 0) return;
	const coversUpToId = sourceEntryIds.at(-1);
	if (!coversUpToId) return;

	if (sourceEntryIds.length < backlogEntries.length || truncatedSourceEntryIds.length > 0) {
		debugLog("curator.chunk_capped", {
			maxChunkTokens,
			backlogEntries: backlogEntries.length,
			backlogTokens: tokens,
			chunkEntries: sourceEntryIds.length,
			chunkTokens,
			truncatedSourceEntryIds,
		});
	}

	const folded = foldLedger(entries);
	if (shouldNotifyWorker(config, ctx)) {
		ctx.ui?.notify(`Observational memory: curator running on ~${chunkTokens.toLocaleString()}-token chunk`, "info");
	}
	debugLog("curator.start", {
		tokens,
		chunkTokens,
		coversUpToId,
		sourceEntryIds,
		sourceEntryCount: sourceEntryIds.length,
		priorReflections: folded.currentReflections.length,
		priorObservations: folded.activeObservations.length,
	});

	let result: Awaited<ReturnType<typeof runCurator>>;
	try {
		result = await withSidecarUsageContext(
			{ threshold: config.observeAfterTokens, trigger: "observeAfterTokens" },
			() =>
				runCurator({
					model: resolved.model as any,
					apiKey: resolved.apiKey,
					headers: resolved.headers,
					reflections: folded.currentReflections,
					observations: folded.activeObservations,
					chunk,
					allowedSourceEntryIds: sourceEntryIds,
					targetTokens: config.observationsPoolTargetTokens,
					maxTurns: config.agentMaxTurns,
					thinkingLevel: resolved.thinkingLevel ?? "low",
					signal: runtime.consolidationSignal,
				}),
		);
		if (runtime.disposed) return;
	} catch (error) {
		if (error instanceof CuratorStreamError) {
			if (error.stopReason === "aborted" && runtime.consolidationSignal?.aborted) return;
			runtime.recordConsolidationStageError(ctx, "curator", error);
			return;
		}
		throw error;
	}

	if (!result) {
		armEmptyBackoff(runtime, sessionIdentity, coverageId, tokens, config, ctx, coversUpToId);
		return;
	}

	appendCuratorRecords(pi, runtime, ctx, config, {
		entries,
		folded,
		result,
		coversUpToId,
		sessionIdentity,
		coverageId,
		tokens,
	});
}

function armEmptyBackoff(
	runtime: Runtime,
	sessionIdentity: string | undefined,
	coverageId: string | undefined,
	tokens: number,
	config: Config,
	ctx: ConsolidationCtx,
	coversUpToId: string,
): void {
	debugLog("curator.empty", { coversUpToId });
	runtime.observerEmptyBackoff = { sessionIdentity, coverageId, tokensAtEmpty: tokens };
	if (shouldNotifyWorker(config, ctx)) {
		ctx.ui?.notify(
			"Observational memory: curator found nothing to record in this chunk (coverage unchanged; will retry later)",
			"info",
		);
	}
}

function appendCuratorRecords(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: ConsolidationCtx,
	config: Config,
	args: {
		entries: Entry[];
		folded: ReturnType<typeof foldLedger>;
		result: NonNullable<Awaited<ReturnType<typeof runCurator>>>;
		coversUpToId: string;
		sessionIdentity: string | undefined;
		coverageId: string | undefined;
		tokens: number;
	},
): void {
	const { entries, folded, result, coversUpToId, sessionIdentity, coverageId, tokens } = args;
	const observationCoverageId =
		result.observations.length > 0 ? coversUpToId : latestCoverageMarkerId(entries, OM_OBSERVATIONS_RECORDED);
	if (result.observations.length === 0) {
		runtime.observerEmptyBackoff = { sessionIdentity, coverageId, tokensAtEmpty: tokens };
	} else {
		runtime.observerEmptyBackoff = undefined;
		const recorded = buildObservationsRecordedData(result.observations, coversUpToId);
		if (recorded && !appendEntry(pi, runtime, OM_OBSERVATIONS_RECORDED, recorded)) return;
	}

	if (!observationCoverageId) return;

	const recordedReflections = buildReflectionsRecordedData(result.reflections, observationCoverageId);
	if (recordedReflections && !appendEntry(pi, runtime, OM_REFLECTIONS_RECORDED, recordedReflections)) return;

	const currentIds = new Set(folded.currentReflections.map((reflection) => reflection.id));
	const retiredIds = result.retiredIds.filter((id) => currentIds.has(id));
	const successorIds = result.reflections.map((reflection) => reflection.id);
	const retired = buildReflectionsRetiredData(
		retiredIds,
		observationCoverageId,
		successorIds.length > 0 ? successorIds : undefined,
	);
	if (retired && !appendEntry(pi, runtime, OM_REFLECTIONS_RETIRED, retired)) return;

	const dropped = buildObservationsDroppedData(result.droppedIds, observationCoverageId);
	if (dropped && !appendEntry(pi, runtime, OM_OBSERVATIONS_DROPPED, dropped)) return;

	debugLog("curator.appended", {
		observations: result.observations.length,
		reflections: result.reflections.length,
		retiredIds: retiredIds.length,
		droppedIds: result.droppedIds.length,
		coversUpToId: observationCoverageId,
	});
	if (!shouldNotifyWorker(config, ctx)) return;
	const parts = [
		result.observations.length > 0
			? `${result.observations.length} observation${result.observations.length === 1 ? "" : "s"}`
			: undefined,
		result.reflections.length > 0
			? `${result.reflections.length} reflection${result.reflections.length === 1 ? "" : "s"}`
			: undefined,
		retiredIds.length > 0 ? `${retiredIds.length} retired` : undefined,
		result.droppedIds.length > 0
			? `${result.droppedIds.length} drop${result.droppedIds.length === 1 ? "" : "s"}`
			: undefined,
	].filter((part): part is string => part !== undefined);
	if (parts.length > 0) ctx.ui?.notify(`Observational memory: ${parts.join(", ")} recorded`, "info");
}
