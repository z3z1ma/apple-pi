import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { runDropper } from "../agents/dropper/agent.js";
import { observationPoolMetrics } from "../agents/dropper/pool.js";
import { ObserverStreamError, runObserver } from "../agents/observer/agent.js";
import { runReflector } from "../agents/reflector/agent.js";
import { debugLog, withDebugLogContext } from "../debug-log.js";
import { resolveObserverChunkMaxTokens, type Config } from "../config.js";
import { isStaleExtensionCtxError, type ResolveResult, type Runtime } from "../runtime.js";
import { serializeSourceAddressedBranchEntries } from "../serialize.js";
import {
	OM_OBSERVATIONS_DROPPED,
	OM_OBSERVATIONS_RECORDED,
	OM_REFLECTIONS_RECORDED,
	OM_REFLECTIONS_RETIRED,
	buildObservationsDroppedData,
	buildObservationsRecordedData,
	buildReflectionsRecordedData,
	buildReflectionsRetiredData,
	earlierCoverageMarkerId,
	foldLedger,
	fullProjection,
	isSourceEntry,
	latestCoverageIndex,
	latestCoverageMarkerId,
	observationToSummaryLine,
	realTokensSinceAnchor,
	realTokensSinceCoverageIndex,
	latestReflectionCoverageIndex,
	rawTokensSinceObservationCoverage,
	rawTokensSinceReflectionCoverage,
	reflectionToSummaryLine,
	type Entry,
	type FoldedLedger,
	type Observation,
	type Reflection,
	type V3MemoryCustomType,
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

type StageOutcome = "continue" | "abort";

type ReflectorStageResult = {
	outcome: StageOutcome;
	sameRunReflections: Reflection[];
	sameRunRetiredIds: string[];
	effectiveReflectionCoverageId?: string;
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

function memoryIdFingerprint(ids: readonly string[]): string {
	return [...ids].sort().join(",");
}

function tokensSinceObservationCoverage(entries: Entry[], currentTokens: number | undefined): number {
	const real =
		currentTokens !== undefined ? realTokensSinceAnchor(entries, OM_OBSERVATIONS_RECORDED, currentTokens) : undefined;
	return real !== undefined ? real : rawTokensSinceObservationCoverage(entries);
}

function dropperNoDropBackoffActive(
	runtime: Runtime,
	sessionIdentity: string | undefined,
	folded: FoldedLedger,
	tokens: number,
	observeAfterTokens: number,
): boolean {
	const backoff = runtime.dropperNoDropBackoff;
	if (!backoff) return false;
	const lawFingerprint = memoryIdFingerprint(folded.currentReflections.map((reflection) => reflection.id));
	const observationFingerprint = memoryIdFingerprint(folded.activeObservations.map((observation) => observation.id));
	if (
		sessionIdentity !== backoff.sessionIdentity ||
		lawFingerprint !== backoff.lawFingerprint ||
		observationFingerprint !== backoff.observationFingerprint ||
		tokens >= backoff.tokensAtEmpty + observeAfterTokens
	) {
		runtime.dropperNoDropBackoff = undefined;
		return false;
	}
	return true;
}

function setDropperNoDropBackoff(
	runtime: Runtime,
	sessionIdentity: string | undefined,
	folded: FoldedLedger,
	tokens: number,
): void {
	runtime.dropperNoDropBackoff = {
		sessionIdentity,
		lawFingerprint: memoryIdFingerprint(folded.currentReflections.map((reflection) => reflection.id)),
		observationFingerprint: memoryIdFingerprint(folded.activeObservations.map((observation) => observation.id)),
		tokensAtEmpty: tokens,
	};
}

function tokensSinceReflectionCoverage(entries: Entry[], currentTokens: number | undefined): number {
	const real =
		currentTokens !== undefined
			? realTokensSinceCoverageIndex(entries, latestReflectionCoverageIndex(entries), currentTokens)
			: undefined;
	return real !== undefined ? real : rawTokensSinceReflectionCoverage(entries);
}

function reflectorMaintenanceBackoffActive(
	runtime: Runtime,
	sessionIdentity: string | undefined,
	observationCoverageId: string | undefined,
	tokens: number,
	reflectAfterTokens: number,
): boolean {
	const backoff = runtime.reflectorMaintenanceBackoff;
	if (!backoff) return false;
	if (
		sessionIdentity !== backoff.sessionIdentity ||
		observationCoverageId !== backoff.observationCoverageId ||
		tokens >= backoff.tokensAtEmpty + reflectAfterTokens
	) {
		runtime.reflectorMaintenanceBackoff = undefined;
		return false;
	}
	return true;
}

function dropperLaunchDue(
	entries: Entry[],
	config: Config,
	runtime: Runtime,
	sessionIdentity: string | undefined,
	currentTokens: number | undefined,
): boolean {
	const folded = foldLedger(entries);
	const metrics = observationPoolMetrics(folded.activeObservations, config.observationsPoolTargetTokens);
	if (!metrics.ready) return false;
	const tokens = tokensSinceObservationCoverage(entries, currentTokens);
	return !dropperNoDropBackoffActive(runtime, sessionIdentity, folded, tokens, config.observeAfterTokens);
}

/**
 * Real current context tokens from the session (provider-reported usage, the
 * same basis the footer percentage uses). Falls back to undefined when the
 * host pi lacks getContextUsage or the count is unknown (e.g. right after a
 * compaction, before the next valid assistant response).
 */
function realContextTokens(ctx: ConsolidationCtx): number | undefined {
	const usage = typeof ctx.getContextUsage === "function" ? ctx.getContextUsage() : undefined;
	const tokens = usage?.tokens;
	return typeof tokens === "number" && Number.isFinite(tokens) ? tokens : undefined;
}

function coverageIndexForStage(entries: Entry[], customType: V3MemoryCustomType): number {
	if (customType === OM_REFLECTIONS_RECORDED) return latestReflectionCoverageIndex(entries);
	return latestCoverageIndex(entries, customType);
}

function stageDue(
	entries: Entry[],
	currentTokens: number | undefined,
	customType: V3MemoryCustomType,
	rawEstimateFn: (entries: Entry[]) => number,
	threshold: number,
): boolean {
	if (currentTokens !== undefined) {
		const real = realTokensSinceCoverageIndex(
			entries,
			coverageIndexForStage(entries, customType),
			currentTokens,
		);
		if (real !== undefined) return real >= threshold;
	}
	// Real delta unmeasurable (no usage baseline, or accounting basis changed) or
	// old pi host without getContextUsage — fall back to the raw estimate, which
	// self-limits after coverage and cannot over-fire or starve.
	return rawEstimateFn(entries) >= threshold;
}

function anyStageDue(
	entries: Entry[],
	config: Config,
	runtime: Runtime,
	sessionIdentity: string | undefined,
	currentTokens: number | undefined,
): boolean {
	const observationCoverageId = latestCoverageMarkerId(entries, OM_OBSERVATIONS_RECORDED);
	const reflectionTokens = tokensSinceReflectionCoverage(entries, currentTokens);
	const reflectorDue =
		stageDue(
			entries,
			currentTokens,
			OM_REFLECTIONS_RECORDED,
			rawTokensSinceReflectionCoverage,
			config.reflectAfterTokens,
		) &&
		!reflectorMaintenanceBackoffActive(
			runtime,
			sessionIdentity,
			observationCoverageId,
			reflectionTokens,
			config.reflectAfterTokens,
		);
	return (
		stageDue(
			entries,
			currentTokens,
			OM_OBSERVATIONS_RECORDED,
			rawTokensSinceObservationCoverage,
			config.observeAfterTokens,
		) ||
		reflectorDue ||
		dropperLaunchDue(entries, config, runtime, sessionIdentity, currentTokens)
	);
}

function shouldNotifyWorker(config: Config, ctx: ConsolidationCtx): boolean {
	return config.showWorkerNotifications && ctx.hasUI;
}

function makeModelResolver(
	runtime: Runtime,
	ctx: ConsolidationCtx,
): (stage: "observer" | "reflector" | "dropper") => Promise<ResolvedModel | undefined> {
	let cached: ResolveResult | undefined;
	return async (stage) => {
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
		debugLog(`${stage}.model_unavailable`, { reason: cached.reason });
		if (!runtime.resolveFailureNotified && ctx.hasUI && ctx.ui) {
			ctx.ui.notify(`Observational memory: ${stage} skipped — ${cached.reason}`, "warning");
			runtime.resolveFailureNotified = true;
		}
		return undefined;
	};
}

export function registerConsolidationTrigger(pi: ExtensionAPI, runtime: Runtime): void {
	const launch = (_event: unknown, ctx: ConsolidationCtx) => {
		maybeLaunchConsolidation(pi, runtime, ctx);
	};
	pi.on("agent_start", launch);
	pi.on("turn_end", launch);
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
	if (!anyStageDue(entries, config, runtime, sessionIdentity, realContextTokens(ctx))) return;

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
			async () => {
				await runConsolidationPipeline(pi, runtime, consolidationCtx, config);
			},
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
	const resolveModel = makeModelResolver(runtime, ctx);

	runtime.consolidationPhase = "observer";
	try {
		const observerOutcome = await runObserverStage(pi, runtime, ctx, resolveModel, config);
		if (observerOutcome === "abort") return;
	} catch (error) {
		debugLog("observer.error", { errorMessage: runtime.recordConsolidationStageError(ctx, "observer", error) });
		return;
	}

	if (runtime.disposed) return;
	runtime.consolidationPhase = "reflector";
	let reflectorResult: ReflectorStageResult;
	try {
		reflectorResult = await runReflectorStage(pi, runtime, ctx, resolveModel, config);
		if (reflectorResult.outcome === "abort") return;
	} catch (error) {
		debugLog("reflector.error", { errorMessage: runtime.recordConsolidationStageError(ctx, "reflector", error) });
		return;
	}

	if (runtime.disposed) return;
	runtime.consolidationPhase = "dropper";
	try {
		await runDropperStage(
			pi,
			runtime,
			ctx,
			resolveModel,
			reflectorResult.sameRunReflections,
			reflectorResult.effectiveReflectionCoverageId,
			config,
		);
	} catch (error) {
		debugLog("dropper.error", { errorMessage: runtime.recordConsolidationStageError(ctx, "dropper", error) });
	}
}

async function runObserverStage(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: ConsolidationCtx,
	resolveModel: (stage: "observer") => Promise<ResolvedModel | undefined>,
	config: Config,
): Promise<StageOutcome> {
	if (runtime.disposed) return "abort";
	const entries = ctx.sessionManager.getBranch() as Entry[];
	const currentTokens = realContextTokens(ctx);
	const real =
		currentTokens !== undefined ? realTokensSinceAnchor(entries, OM_OBSERVATIONS_RECORDED, currentTokens) : undefined;
	const tokens = real !== undefined ? real : rawTokensSinceObservationCoverage(entries); // fallback: no usage baseline / basis change
	if (tokens < config.observeAfterTokens) return "continue";

	const sessionMetadata = debugSessionMetadata(ctx);
	const sessionIdentity = sessionMetadata.sessionId ?? sessionMetadata.sessionFile;
	const coverageId = latestCoverageMarkerId(entries, OM_OBSERVATIONS_RECORDED);

	// Deliberate-empty backoff (#23): an intentional "nothing to record" verdict
	// must not re-fire the observer every turn over the same span. Retry only
	// after another observeAfterTokens worth of new source tokens arrives, and
	// drop the backoff as soon as coverage advances.
	const backoff = runtime.observerEmptyBackoff;
	if (backoff) {
		if (
			sessionIdentity !== backoff.sessionIdentity ||
			coverageId !== backoff.coverageId ||
			tokens >= backoff.tokensAtEmpty + config.observeAfterTokens
		) {
			runtime.observerEmptyBackoff = undefined;
		} else {
			debugLog("observer.empty_backoff", {
				tokens,
				resumeAtTokens: backoff.tokensAtEmpty + config.observeAfterTokens,
			});
			return "continue";
		}
	}

	// Resolve the model before building the chunk: the default chunk cap
	// derives from the resolved model's context window.
	const resolved = await resolveModel("observer");
	if (runtime.disposed) return "abort";
	if (!resolved) return "abort";

	const lastCoverageIdx = latestCoverageIndex(entries, OM_OBSERVATIONS_RECORDED);
	const backlogEntries = sourceEntriesAfter(entries, lastCoverageIdx);

	// Budget the text that is actually sent to the observer, including source
	// labels and rendered message content. Complete entries are kept intact.
	// Only a first entry that cannot fit by itself is represented by a clearly
	// marked head/tail excerpt; the original ledger entry remains untouched.
	const contextWindow = (resolved.model as { contextWindow?: number }).contextWindow;
	const maxChunkTokens = resolveObserverChunkMaxTokens(config, contextWindow);
	const {
		text: chunk,
		sourceEntryIds,
		estimatedTokens: chunkTokens,
		truncatedSourceEntryIds,
	} = serializeSourceAddressedBranchEntries(backlogEntries, { maxTokens: maxChunkTokens });
	if (!chunk.trim() || sourceEntryIds.length === 0) return "continue";
	const coversUpToId = sourceEntryIds.at(-1);
	if (!coversUpToId) return "continue";

	if (sourceEntryIds.length < backlogEntries.length || truncatedSourceEntryIds.length > 0) {
		debugLog("observer.chunk_capped", {
			maxChunkTokens,
			backlogEntries: backlogEntries.length,
			backlogTokens: tokens,
			chunkEntries: sourceEntryIds.length,
			chunkTokens,
			truncatedSourceEntryIds,
		});
	}

	const memory = fullProjection(entries);
	const priorReflections = memory.reflections.map(reflectionToSummaryLine);
	const priorObservations = memory.observations.map(observationToSummaryLine);

	if (shouldNotifyWorker(config, ctx))
		ctx.ui?.notify(`Observational memory: observer running on ~${chunkTokens.toLocaleString()}-token chunk`, "info");
	debugLog("observer.start", {
		tokens,
		chunkTokens,
		coversUpToId,
		sourceEntryIds,
		sourceEntryCount: sourceEntryIds.length,
		priorReflections: priorReflections.length,
		priorObservations: priorObservations.length,
	});

	let observations: Observation[] | undefined;
	try {
		observations = await runObserver({
			model: resolved.model as any,
			apiKey: resolved.apiKey,
			headers: resolved.headers,
			priorReflections,
			priorObservations,
			chunk,
			allowedSourceEntryIds: sourceEntryIds,
			maxTurns: config.agentMaxTurns,
			thinkingLevel: resolved.thinkingLevel ?? "low",
		});
		if (runtime.disposed) return "abort";
	} catch (error) {
		if (error instanceof ObserverStreamError) {
			// API/stream failure is not a clean empty (#32): surface it as a real
			// failure instead of the "no observations" path. Coverage stays put.
			runtime.recordConsolidationStageError(ctx, "observer", error);
			return "abort";
		}
		throw error;
	}
	if (!observations || observations.length === 0) {
		// Deliberate empty: routine info, not a warning, and back off re-fires
		// over the same span (#23).
		debugLog("observer.empty", { coversUpToId });
		runtime.observerEmptyBackoff = { sessionIdentity, coverageId, tokensAtEmpty: tokens };
		if (shouldNotifyWorker(config, ctx))
			ctx.ui?.notify(
				"Observational memory: observer found nothing new in this chunk (coverage unchanged; will retry later)",
				"info",
			);
		return "continue";
	}
	runtime.observerEmptyBackoff = undefined;

	const data = buildObservationsRecordedData(observations, coversUpToId);
	if (!data) return "continue";
	debugLog("observer.records", {
		count: observations.length,
		observationTokens: observations.reduce((sum, observation) => sum + observation.tokenCount, 0),
		coversUpToId,
	});
	if (!appendEntry(pi, runtime, OM_OBSERVATIONS_RECORDED, data)) return "abort";
	debugLog("observer.appended", { count: observations.length, coversUpToId });
	if (shouldNotifyWorker(config, ctx))
		ctx.ui?.notify(
			`Observational memory: ${observations.length} observation${observations.length === 1 ? "" : "s"} recorded`,
			"info",
		);
	return "continue";
}

async function runReflectorStage(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: ConsolidationCtx,
	resolveModel: (stage: "reflector") => Promise<ResolvedModel | undefined>,
	config: Config,
): Promise<ReflectorStageResult> {
	const empty: ReflectorStageResult = { outcome: "continue", sameRunReflections: [], sameRunRetiredIds: [] };
	if (runtime.disposed) return { ...empty, outcome: "abort" };
	const entries = ctx.sessionManager.getBranch() as Entry[];
	const currentTokens = realContextTokens(ctx);
	const reflectionTokens = tokensSinceReflectionCoverage(entries, currentTokens);
	if (reflectionTokens < config.reflectAfterTokens) return empty;

	const observationCoverageId = latestCoverageMarkerId(entries, OM_OBSERVATIONS_RECORDED);
	if (!observationCoverageId) return empty;

	const sessionMetadata = debugSessionMetadata(ctx);
	const sessionIdentity = sessionMetadata.sessionId ?? sessionMetadata.sessionFile;
	if (
		reflectorMaintenanceBackoffActive(
			runtime,
			sessionIdentity,
			observationCoverageId,
			reflectionTokens,
			config.reflectAfterTokens,
		)
	) {
		debugLog("reflector.maintenance_backoff", {
			reflectionTokens,
			resumeAtTokens:
				(runtime.reflectorMaintenanceBackoff?.tokensAtEmpty ?? reflectionTokens) + config.reflectAfterTokens,
		});
		return empty;
	}

	if (shouldNotifyWorker(config, ctx))
		ctx.ui?.notify(`Observational memory: reflector running (~${reflectionTokens.toLocaleString()} tokens)`, "info");
	const resolved = await resolveModel("reflector");
	if (runtime.disposed) return { ...empty, outcome: "abort" };
	if (!resolved) return { ...empty, outcome: "abort" };

	const folded = foldLedger(entries);
	const coverageBefore = latestReflectionCoverageIndex(entries);
	const result = await runReflector({
		model: resolved.model as any,
		apiKey: resolved.apiKey,
		headers: resolved.headers,
		reflections: folded.currentReflections,
		observations: folded.activeObservations,
		maxTurns: config.agentMaxTurns,
		thinkingLevel: resolved.thinkingLevel ?? "low",
	});
	if (runtime.disposed) return { ...empty, outcome: "abort" };
	const armReflectorBackoff = () => {
		runtime.reflectorMaintenanceBackoff = {
			sessionIdentity,
			observationCoverageId,
			tokensAtEmpty: reflectionTokens,
		};
	};
	if (!result) {
		armReflectorBackoff();
		return empty;
	}

	const recorded = buildReflectionsRecordedData(result.reflections, observationCoverageId);
	if (recorded && !appendEntry(pi, runtime, OM_REFLECTIONS_RECORDED, recorded)) return { ...empty, outcome: "abort" };
	const currentIds = new Set(folded.currentReflections.map((reflection) => reflection.id));
	const retiredIds = result.retiredIds.filter((id) => currentIds.has(id));
	const successorIds = result.reflections.map((reflection) => reflection.id);
	const retired = buildReflectionsRetiredData(
		retiredIds,
		observationCoverageId,
		successorIds.length > 0 ? successorIds : undefined,
	);
	if (retired && !appendEntry(pi, runtime, OM_REFLECTIONS_RETIRED, retired)) return { ...empty, outcome: "abort" };
	if (!recorded && !retired) {
		armReflectorBackoff();
		return empty;
	}
	const coverageAfter = latestReflectionCoverageIndex(ctx.sessionManager.getBranch() as Entry[]);
	if (coverageAfter <= coverageBefore) armReflectorBackoff();
	else runtime.reflectorMaintenanceBackoff = undefined;
	return {
		outcome: "continue",
		sameRunReflections: result.reflections,
		sameRunRetiredIds: retiredIds,
		effectiveReflectionCoverageId: observationCoverageId,
	};
}

async function runDropperStage(
	pi: ExtensionAPI,
	runtime: Runtime,
	ctx: ConsolidationCtx,
	resolveModel: (stage: "dropper") => Promise<ResolvedModel | undefined>,
	sameRunReflections: Reflection[],
	sameRunReflectionCoverageId: string | undefined,
	config: Config,
): Promise<StageOutcome> {
	if (runtime.disposed) return "abort";
	const entries = ctx.sessionManager.getBranch() as Entry[];
	const observationCoverageId = latestCoverageMarkerId(entries, OM_OBSERVATIONS_RECORDED);
	if (!observationCoverageId) return "continue";

	const folded = foldLedger(entries);
	const metrics = observationPoolMetrics(folded.activeObservations, config.observationsPoolTargetTokens);
	const activeObservationIds = new Set(folded.activeObservations.map((observation) => observation.id));
	const currentReflectionIds = new Set(folded.currentReflections.map((reflection) => reflection.id));
	const persistedSameRunReflections = sameRunReflections.filter((reflection) => currentReflectionIds.has(reflection.id));
	const maintenanceEligibleObservationIds = Array.from(
		new Set(persistedSameRunReflections.flatMap((reflection) => reflection.supportingObservationIds)),
	).filter((id) => activeObservationIds.has(id));
	const reflectionMaintenance = !metrics.ready && maintenanceEligibleObservationIds.length > 0;
	if (!metrics.ready && !reflectionMaintenance) {
		debugLog("dropper.not_ready", {
			observationTokens: metrics.observationTokens,
			targetTokens: metrics.targetTokens,
			tokensOverTarget: metrics.tokensOverTarget,
			fullness: metrics.fullness,
			activeObservationCount: metrics.activeObservationCount,
			droppableCount: metrics.droppableCount,
			maxDropsAllowed: metrics.maxDropsAllowed,
			maintenanceEligibleObservationIdsCount: maintenanceEligibleObservationIds.length,
		});
		return "continue";
	}

	const sessionMetadata = debugSessionMetadata(ctx);
	const sessionIdentity = sessionMetadata.sessionId ?? sessionMetadata.sessionFile;
	const tokens = tokensSinceObservationCoverage(entries, realContextTokens(ctx));
	if (dropperNoDropBackoffActive(runtime, sessionIdentity, folded, tokens, config.observeAfterTokens)) {
		debugLog("dropper.empty_backoff", {
			tokens,
			resumeAtTokens: (runtime.dropperNoDropBackoff?.tokensAtEmpty ?? tokens) + config.observeAfterTokens,
		});
		return "continue";
	}

	debugLog("dropper.stage_start", {
		observationCoverageId,
		sameRunReflectionCoverageId,
		sameRunReflectionCount: sameRunReflections.length,
		activeObservationCount: metrics.activeObservationCount,
		observationTokens: metrics.observationTokens,
		targetTokens: metrics.targetTokens,
		tokensOverTarget: metrics.tokensOverTarget,
		fullness: metrics.fullness,
		maxDropsAllowed: reflectionMaintenance ? 1 : metrics.maxDropsAllowed,
		reflectionMaintenance,
		persistedSameRunReflectionCount: persistedSameRunReflections.length,
		maintenanceEligibleObservationIdsCount: maintenanceEligibleObservationIds.length,
	});

	if (shouldNotifyWorker(config, ctx)) {
		const message = reflectionMaintenance
			? `Observational memory: dropper checking ${maintenanceEligibleObservationIds.length.toLocaleString()} newly reflected observation${maintenanceEligibleObservationIds.length === 1 ? "" : "s"} for one safe maintenance drop`
			: `Observational memory: dropper running — active observation pool ~${metrics.observationTokens.toLocaleString()} / ${metrics.targetTokens.toLocaleString()} target tokens (${Math.round(metrics.fullness * 100).toLocaleString()}%)`;
		ctx.ui?.notify(message, "info");
	}
	const resolved = await resolveModel("dropper");
	if (runtime.disposed) return "abort";
	if (!resolved) return "abort";

	const droppedIds = await runDropper({
		model: resolved.model as any,
		apiKey: resolved.apiKey,
		headers: resolved.headers,
		reflections: folded.currentReflections,
		observations: folded.activeObservations,
		targetTokens: config.observationsPoolTargetTokens,
		...(reflectionMaintenance ? { maintenanceEligibleObservationIds } : {}),
		maxTurns: config.agentMaxTurns,
		thinkingLevel: resolved.thinkingLevel ?? "low",
	});
	if (runtime.disposed) return "abort";
	const coversUpToId = earlierCoverageMarkerId(entries, observationCoverageId, sameRunReflectionCoverageId);
	const data = coversUpToId && droppedIds ? buildObservationsDroppedData(droppedIds, coversUpToId) : undefined;
	const appended = data ? appendEntry(pi, runtime, OM_OBSERVATIONS_DROPPED, data) : false;
	debugLog("dropper.append", {
		droppedIdsCount: droppedIds?.length ?? 0,
		coversUpToId,
		dataBuilt: data !== undefined,
		appended,
	});
	if (data) {
		if (!appended) return "abort";
		runtime.dropperNoDropBackoff = undefined;
	} else {
		setDropperNoDropBackoff(runtime, sessionIdentity, folded, tokens);
	}
	return "continue";
}
