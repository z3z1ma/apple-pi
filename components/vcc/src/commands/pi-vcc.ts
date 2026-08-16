import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { PI_VCC_COMPACT_INSTRUCTION, type CompactionStatsGetter } from "../hooks/before-compact.js";
import { countPiVccCompactionsFromSession, ordinalSuffix } from "../core/compaction-count.js";

const formatTokens = (n: number): string => {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
};

export const registerPiVccCommand = (pi: ExtensionAPI, getLastCompactionStats: CompactionStatsGetter) => {
	pi.registerCommand("pi-vcc", {
		description: "Compact conversation with pi-vcc structured summary",
		handler: async (_args, ctx) => {
			ctx.compact({
				customInstructions: PI_VCC_COMPACT_INSTRUCTION,
				onComplete: () => {
					const stats = getLastCompactionStats();
					const count = countPiVccCompactionsFromSession(ctx.sessionManager);
					const compactionLabel = count > 0 ? ` (${count}${ordinalSuffix(count)} compaction)` : "";
					if (stats) {
						ctx.ui.notify(
							`pi-vcc: ${stats.summarized} source entries processed; tail kept ${stats.kept} (~${formatTokens(stats.keptTokensEst)} tok).${compactionLabel}`,
							"info",
						);
					} else {
						ctx.ui.notify(`Compacted with pi-vcc${compactionLabel}`, "info");
					}
				},
				onError: (err) => {
					if (err.message === "Compaction cancelled" || err.message === "Already compacted") {
						ctx.ui.notify("Nothing to compact", "warning");
					} else {
						ctx.ui.notify(`Compaction failed: ${err.message}`, "error");
					}
				},
			});
		},
	});
};
