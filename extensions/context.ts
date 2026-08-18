import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerStatusCommand } from "../components/memory/src/commands/status.js";
import { registerViewCommand } from "../components/memory/src/commands/view.js";
import { registerCompactionTrigger } from "../components/memory/src/hooks/compaction-trigger.js";
import { registerConsolidationTrigger } from "../components/memory/src/hooks/consolidation-trigger.js";
import { Runtime } from "../components/memory/src/runtime.js";
import { buildCompactionProjection, type Entry, renderSummary } from "../components/memory/src/session-ledger/index.js";
import { registerRecallTool as registerMemoryRecallTool } from "../components/memory/src/tools/recall-observation.js";
import { hasEvaluableUsageThreshold, resolveUsageCompactionTrigger } from "../components/vcc/src/core/settings.js";
import type { VccCompactionAugmenter } from "../components/vcc/src/hooks/before-compact.js";
import { isProactiveTriggerActive } from "../components/vcc/src/hooks/proactive-threshold.js";
import { installVcc } from "./vcc.js";

function contextTokens(ctx: { getContextUsage?: () => { tokens?: number | null } | undefined }): number | undefined {
	const tokens = ctx.getContextUsage?.()?.tokens;
	return typeof tokens === "number" && Number.isFinite(tokens) ? tokens : undefined;
}

/** VCC owns compaction when it can evaluate a usage-vs-window waterline this turn. */
function hostOwnsUsageThreshold(ctx: {
	model?: { id?: string; provider?: string; contextWindow?: number };
	getContextUsage?: () => { tokens?: number | null } | undefined;
}): boolean {
	return hasEvaluableUsageThreshold(ctx.model, contextTokens(ctx));
}

function vccUsageCompactionClock(ctx: {
	model?: { id?: string; provider?: string; contextWindow?: number };
	getContextUsage?: () => { tokens?: number | null } | undefined;
}): { progress: number; threshold: number } | undefined {
	const progress = contextTokens(ctx);
	const threshold = resolveUsageCompactionTrigger(ctx.model);
	if (progress === undefined || threshold === undefined) return undefined;
	return { progress, threshold };
}

/**
 * One context extension owns compaction for the root session. VCC chooses the
 * deterministic cut and transcript summary; observational memory adds its
 * ledger projection to that same summary and details record. The OM ledger
 * itself remains in Pi's session JSONL and is never mirrored into the project
 * tree. Children and workers load `extensions/vcc.ts` instead, without memory.
 */
export function createMemoryCompactionAugmenter(memory: Runtime): VccCompactionAugmenter {
	return ({ branchEntries, firstKeptEntryId, cwd }) => {
		memory.ensureConfig(cwd);
		const boundaryId = firstKeptEntryId || branchEntries.at(-1)?.id || "";
		const projection = buildCompactionProjection(branchEntries as Entry[], boundaryId, {
			observationsPoolMaxTokens: memory.config.observationsPoolMaxTokens,
		});
		return {
			summary: renderSummary(projection.reflections, projection.observations),
			// Keep both VCC's `compactor` and OM's `type` at the top level. Their
			// recall/projection readers intentionally recognize the same entry.
			details: projection.details,
		};
	};
}

export default function context(pi: ExtensionAPI): void {
	const memory = new Runtime();
	installVcc(pi, createMemoryCompactionAugmenter(memory));
	registerConsolidationTrigger(pi, memory);
	registerCompactionTrigger(pi, memory, {
		hostCompactionPending: isProactiveTriggerActive,
		hostOwnsUsageThreshold: hostOwnsUsageThreshold,
	});
	registerStatusCommand(pi, memory, {
		compactionClock: (ctx) => {
			const clock = vccUsageCompactionClock(ctx);
			return clock ? { ...clock, unit: "context" } : undefined;
		},
	});
	registerViewCommand(pi, memory);
	registerMemoryRecallTool(pi);
}
