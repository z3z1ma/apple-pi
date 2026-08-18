import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { observationPoolMetrics } from "../agents/dropper/pool.js";
import { resolveCompactAfterTokens } from "../config.js";
import type { Runtime } from "../runtime.js";
import {
	diffProjection,
	type Entry,
	foldLedger,
	fullProjection,
	rawTokensSinceLastCompaction,
	rawTokensSinceObservationCoverage,
	visibleProjection,
} from "../session-ledger/index.js";

function pct(current: number, total: number): number {
	return total > 0 ? Math.round((current / total) * 100) : 0;
}

function tokenSum(items: { tokenCount: number }[]): number {
	return items.reduce((sum, item) => sum + item.tokenCount, 0);
}

function addedSuffix(count: number): string | undefined {
	return count > 0 ? `+${count.toLocaleString()}` : undefined;
}

function removedSuffix(count: number): string | undefined {
	return count > 0 ? `-${count.toLocaleString()}` : undefined;
}

function appendSuffixes(line: string, suffixes: (string | undefined)[]): string {
	const rendered = suffixes.filter((suffix): suffix is string => suffix !== undefined);
	return rendered.length > 0 ? `${line} ${rendered.join(" ")}` : line;
}

export type CompactionStatusClock = {
	progress: number;
	threshold: number;
	unit: "context" | "source";
};

export type StatusCommandOptions = {
	/** When set and it returns a clock, `/om:status` shows that instead of the source-token fallback. */
	compactionClock?: (ctx: {
		model?: { contextWindow?: number } | undefined;
		getContextUsage?: () => { tokens?: number | null } | undefined;
	}) => CompactionStatusClock | undefined;
};

export function registerStatusCommand(pi: ExtensionAPI, runtime: Runtime, options: StatusCommandOptions = {}): void {
	pi.registerCommand("om:status", {
		description: "Show observational memory status",
		handler: async (_args, ctx) => {
			runtime.ensureConfig(ctx.cwd);
			const entries = ctx.sessionManager.getBranch() as Entry[];
			const folded = foldLedger(entries);
			const visible = visibleProjection(entries);
			const full = fullProjection(entries);
			const drift = diffProjection(visible, full);

			const visibleObservationTokens = tokenSum(visible.observations);
			const visibleReflectionTokens = tokenSum(visible.reflections);
			const activeObservationPool = observationPoolMetrics(
				folded.activeObservations,
				runtime.config.observationsPoolTargetTokens,
			);
			const observationLine = appendSuffixes(
				`Observations: ${folded.observations.length} recorded / ${folded.droppedObservationIds.size} dropped / ${folded.activeObservations.length} active / ${visible.observations.length} visible`,
				[addedSuffix(drift.observationsOnlyInFull.length), removedSuffix(drift.droppedOnlyInFull.length)],
			);
			const reflectionLine = appendSuffixes(
				`Reflections:  ${folded.reflections.length} recorded / ${folded.retiredReflectionIds.size} retired / ${folded.currentReflections.length} current / ${visible.reflections.length} visible`,
				[addedSuffix(drift.reflectionsOnlyInFull.length)],
			);
			const obsProgress = rawTokensSinceObservationCoverage(entries);
			const contextWindow = typeof ctx.model?.contextWindow === "number" ? ctx.model.contextWindow : undefined;
			const hostClock = options.compactionClock?.(ctx);
			const compactionProgress = hostClock?.progress ?? rawTokensSinceLastCompaction(entries);
			const compactThreshold = hostClock?.threshold ?? resolveCompactAfterTokens(runtime.config, contextWindow);
			const compactionUnit = hostClock?.unit === "context" ? "context tokens" : "estimated source tokens";

			const passiveLines =
				runtime.config.passive === true
					? [
							"── Mode ──",
							"Passive: automatic memory workers and auto-compaction disabled; manual/Pi compaction, commands, and recall remain active",
							"",
						]
					: [];

			const lines = [
				...passiveLines,
				"── Memory ──",
				observationLine,
				reflectionLine,
				"",
				"── Activity ──",
				`Next curation:    ~${obsProgress.toLocaleString()} / ${runtime.config.observeAfterTokens.toLocaleString()} tokens (${pct(obsProgress, runtime.config.observeAfterTokens)}%)`,
				`Next compaction:  ~${compactionProgress.toLocaleString()} / ${compactThreshold.toLocaleString()} ${compactionUnit} (${pct(compactionProgress, compactThreshold)}%)`,
				`Visible observation pool: ~${visibleObservationTokens.toLocaleString()} / ${runtime.config.observationsPoolMaxTokens.toLocaleString()} tokens (${pct(visibleObservationTokens, runtime.config.observationsPoolMaxTokens)}%)`,
				`Active observation pool: ~${activeObservationPool.observationTokens.toLocaleString()} / ${runtime.config.observationsPoolTargetTokens.toLocaleString()} target tokens (${pct(activeObservationPool.observationTokens, runtime.config.observationsPoolTargetTokens)}%)`,
				`Reflection pool:         ~${visibleReflectionTokens.toLocaleString()} tokens`,
			];

			if (runtime.consolidationInFlight || runtime.compactInFlight) {
				lines.push("", "── In flight ──");
				if (runtime.consolidationInFlight) {
					const phase = runtime.consolidationPhase ? ` (${runtime.consolidationPhase})` : "";
					lines.push(`Consolidation: running${phase}`);
				}
				if (runtime.compactInFlight) lines.push("Auto-compaction: running");
			}

			if (runtime.lastCuratorError) {
				lines.push("", "── Last error ──");
				lines.push(`Curator: ${runtime.lastCuratorError}`);
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
