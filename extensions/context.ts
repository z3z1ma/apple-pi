import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { registerPiVccCommand } from "../components/vcc/src/commands/pi-vcc.js";
import { registerVccRecallCommand } from "../components/vcc/src/commands/vcc-recall.js";
import { registerInvisibleContinue } from "../components/vcc/src/core/invisible-continue.js";
import { scaffoldSettings } from "../components/vcc/src/core/settings.js";
import {
	registerBeforeCompactHook,
	type VccCompactionAugmenter,
} from "../components/vcc/src/hooks/before-compact.js";
import { registerProactiveThresholdHook } from "../components/vcc/src/hooks/proactive-threshold.js";
import { registerRecallTool as registerVccRecallTool } from "../components/vcc/src/tools/recall.js";

import { registerStatusCommand } from "../components/memory/src/commands/status.js";
import { registerViewCommand } from "../components/memory/src/commands/view.js";
import { registerCompactionTrigger } from "../components/memory/src/hooks/compaction-trigger.js";
import { registerConsolidationTrigger } from "../components/memory/src/hooks/consolidation-trigger.js";
import { Runtime } from "../components/memory/src/runtime.js";
import {
	buildCompactionProjection,
	renderSummary,
	type Entry,
} from "../components/memory/src/session-ledger/index.js";
import { registerRecallTool as registerMemoryRecallTool } from "../components/memory/src/tools/recall-observation.js";

/**
 * One context extension owns compaction. VCC chooses the deterministic cut and
 * transcript summary; observational memory adds its ledger projection to that
 * same summary and details record. The OM ledger itself remains in Pi's session
 * JSONL and is never mirrored into the project tree.
 */
export function createMemoryCompactionAugmenter(memory: Runtime): VccCompactionAugmenter {
	return ({ branchEntries, firstKeptEntryId, cwd }) => {
		memory.ensureConfig(cwd);
		const boundaryId = firstKeptEntryId || branchEntries.at(-1)?.id || "";
		const projection = buildCompactionProjection(
			branchEntries as Entry[],
			boundaryId,
			{ observationsPoolMaxTokens: memory.config.observationsPoolMaxTokens },
		);
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

	scaffoldSettings();
	registerInvisibleContinue(pi);
	registerBeforeCompactHook(pi, createMemoryCompactionAugmenter(memory));
	registerProactiveThresholdHook(pi);
	registerPiVccCommand(pi);
	registerVccRecallCommand(pi);
	registerVccRecallTool(pi);

	registerConsolidationTrigger(pi, memory);
	registerCompactionTrigger(pi, memory);
	registerStatusCommand(pi, memory);
	registerViewCommand(pi, memory);
	registerMemoryRecallTool(pi);
}
