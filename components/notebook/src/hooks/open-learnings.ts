import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

import { type Entry, foldLedger } from "../session-ledger/index.js";

export const OPEN_LEARNINGS_STATUS_KEY = "learnings";

function countOpenLearnings(ctx: ExtensionContext): number {
	return foldLedger((ctx.sessionManager?.getBranch?.() ?? []) as Entry[]).currentReflections.length;
}

/** Learnings last one session, so the editor shows how many still wait for a home. */
export function showOpenLearnings(ctx: ExtensionContext): void {
	const count = countOpenLearnings(ctx);
	ctx.ui?.setStatus?.(OPEN_LEARNINGS_STATUS_KEY, count > 0 ? `learnings:${count}` : undefined);
}

export function ledgerCloseReminder(count: number): string {
	return `This session has ${count} open learning${count === 1 ? "" : "s"}. Before you close the task, propose where each belongs; this task's retrospective.md is the default home. Write what the user approves, retire every placed or dropped learning with update_notebook, then call ledger_status again.`;
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
		const count = countOpenLearnings(ctx);
		if (count === 0) return;
		reminded.add(task);
		return { block: true, reason: ledgerCloseReminder(count) };
	});
}
