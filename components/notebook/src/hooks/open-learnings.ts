import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { LEARNING_PLACEMENT } from "../learning-placement.js";
import { type Entry, foldLedger, type Reflection, reflectionToSummaryLine } from "../session-ledger/index.js";

export const OPEN_LEARNINGS_STATUS_KEY = "learnings";

function openLearnings(ctx: ExtensionContext): readonly Reflection[] {
	return foldLedger((ctx.sessionManager?.getBranch?.() ?? []) as Entry[]).currentReflections;
}

/** Learnings last one session, so the editor shows how many are not placed yet. */
export function showOpenLearnings(ctx: ExtensionContext): void {
	const count = openLearnings(ctx).length;
	ctx.ui?.setStatus?.(OPEN_LEARNINGS_STATUS_KEY, count > 0 ? `learnings:${count}` : undefined);
}

/** Lists each open learning by id, since the caller may not have seen learnings recorded by forked continuations. */
export function ledgerCloseReminder(learnings: readonly Reflection[]): string {
	const count = learnings.length;
	return `This session has ${count} open learning${count === 1 ? "" : "s"}. Before you close the task, place them; this task's retrospective.md is the default home. ${LEARNING_PLACEMENT} Then call ledger_status again.\n\n${learnings.map(reflectionToSummaryLine).join("\n")}`;
}

/**
 * Show the open-learning count, and hold the first close of each ledger task
 * while learnings are open, so they are placed while the retrospective is live.
 */
export function registerOpenLearnings(pi: ExtensionAPI): void {
	const reminded = new Set<string>();

	pi.on("session_start", (_event, ctx) => {
		reminded.clear();
		showOpenLearnings(ctx);
	});
	pi.on("session_tree", (_event, ctx) => showOpenLearnings(ctx));
	pi.on("turn_end", (_event, ctx) => showOpenLearnings(ctx));

	pi.on("tool_call", (event, ctx) => {
		if (event.toolName !== "ledger_status") return;
		const { task, status } = event.input as { task?: unknown; status?: unknown };
		if ((status !== "done" && status !== "cancelled") || typeof task !== "string" || reminded.has(task)) return;
		const learnings = openLearnings(ctx);
		if (learnings.length === 0) return;
		reminded.add(task);
		return { block: true, reason: ledgerCloseReminder(learnings) };
	});
}
