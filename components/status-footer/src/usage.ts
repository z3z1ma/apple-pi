import type { Usage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

import type { FooterUsageTotals } from "./types.js";

function numberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function addUsage(totals: FooterUsageTotals, usage: Usage | undefined): void {
	if (!usage) return;
	totals.input += numberOrZero(usage.input);
	totals.output += numberOrZero(usage.output);
	totals.cacheRead += numberOrZero(usage.cacheRead);
	totals.cacheWrite += numberOrZero(usage.cacheWrite);
	totals.cost += numberOrZero(usage.cost?.total);
}

/**
 * Match Pi's native footer accounting: walk every persisted session entry, not
 * only the active branch. This keeps totals stable after forks and navigation.
 */
export function collectUsageTotals(entries: readonly SessionEntry[]): FooterUsageTotals {
	const totals: FooterUsageTotals = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
	};

	for (const entry of entries) {
		if (entry.type === "message" && entry.message.role === "assistant") {
			addUsage(totals, entry.message.usage);
			const promptTokens =
				numberOrZero(entry.message.usage?.input) +
				numberOrZero(entry.message.usage?.cacheRead) +
				numberOrZero(entry.message.usage?.cacheWrite);
			totals.latestCacheHitRate =
				promptTokens > 0 ? (numberOrZero(entry.message.usage?.cacheRead) / promptTokens) * 100 : undefined;
			continue;
		}

		if (entry.type === "message" && entry.message.role === "toolResult") {
			addUsage(totals, entry.message.usage);
			continue;
		}

		if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			addUsage(totals, entry.usage);
		}
	}

	return totals;
}
