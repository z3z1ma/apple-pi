import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveCompactAfterTokens } from "../config.js";
import { isStaleExtensionCtxError, type Runtime } from "../runtime.js";
import { type Entry, rawTokensSinceLastCompaction } from "../session-ledger/index.js";

/** Pi's manual `ctx.compact()` throws if the live leaf is already a compaction. */
function branchEndsWithCompaction(entries: Entry[] | undefined): boolean {
	if (!entries || entries.length === 0) return false;
	return entries[entries.length - 1]?.type === "compaction";
}

export type CompactionTriggerOptions = {
	/** True while VCC (or another owner) has already called ctx.compact() and session_compact has not fired. */
	hostCompactionPending?: () => boolean;
	/**
	 * True when VCC can evaluate a usage-vs-window waterline this turn.
	 * Memory then leaves `ctx.compact()` to that owner and keeps the
	 * source-token gate only as a fallback.
	 */
	hostOwnsUsageThreshold?: (ctx: {
		model?: { contextWindow?: number } | undefined;
		getContextUsage?: () => { tokens?: number | null } | undefined;
	}) => boolean;
};

export function registerCompactionTrigger(
	pi: ExtensionAPI,
	runtime: Runtime,
	options: CompactionTriggerOptions = {},
): void {
	// Pi emits agent_settled only after retries, automatic compaction, and queued
	// continuation have finished, so retry policy stays owned by Pi.
	pi.on("agent_settled", (_event, ctx) => {
		runtime.ensureConfig(ctx.cwd);
		if (runtime.config.passive === true) return;
		if (runtime.compactInFlight) return;
		if (options.hostCompactionPending?.()) return;

		const entries = ctx.sessionManager?.getBranch?.() as Entry[] | undefined;
		if (!entries) return;
		if (branchEndsWithCompaction(entries)) return;
		if (options.hostOwnsUsageThreshold?.(ctx)) return;
		const progress = rawTokensSinceLastCompaction(entries);
		const contextWindow = typeof ctx.model?.contextWindow === "number" ? ctx.model.contextWindow : undefined;
		const threshold = resolveCompactAfterTokens(runtime.config, contextWindow);
		if (progress < threshold) return;

		// Capture ctx properties synchronously — the setTimeout + async work below
		// may outlive the extension ctx (stale after session replacement/reload).
		const hasUI = ctx.hasUI;
		const ui = ctx.ui;

		if (hasUI)
			ui?.notify(
				`Observational memory: compaction threshold reached (~${progress.toLocaleString()} estimated source tokens); triggering compaction`,
				"info",
			);

		runtime.compactInFlight = true;
		setTimeout(() => {
			try {
				if (options.hostCompactionPending?.()) {
					runtime.compactInFlight = false;
					return;
				}
				if (!ctx.isIdle()) {
					runtime.compactInFlight = false;
					if (hasUI)
						ui?.notify("Observational memory: compaction deferred — agent became busy before compaction", "info");
					return;
				}
				const currentEntries = ctx.sessionManager?.getBranch?.() as Entry[] | undefined;
				if (!currentEntries) {
					runtime.compactInFlight = false;
					return;
				}
				if (options.hostOwnsUsageThreshold?.(ctx)) {
					runtime.compactInFlight = false;
					return;
				}
				const currentProgress = rawTokensSinceLastCompaction(currentEntries);
				if (currentProgress < threshold) {
					runtime.compactInFlight = false;
					if (hasUI)
						ui?.notify(
							"Observational memory: compaction skipped — another compaction already ran before deferred compaction",
							"info",
						);
					return;
				}
				const liveEntries = ctx.sessionManager?.getBranch?.() as Entry[] | undefined;
				if (branchEndsWithCompaction(liveEntries)) {
					runtime.compactInFlight = false;
					return;
				}
				ctx.compact({
					onComplete: () => {
						runtime.compactInFlight = false;
						if (hasUI) ui?.notify("Observational memory: compaction complete", "info");
					},
					onError: (error: { message: string }) => {
						runtime.compactInFlight = false;
						if (error.message === "Compaction cancelled" || error.message === "Already compacted") {
							// Cancelled: we already notified the real reason.
							// Already compacted: the branch leaf is a compaction; a no-op.
							return;
						}
						if (hasUI) ui?.notify(`Observational memory: ${error.message}`, "error");
					},
				});
			} catch (error) {
				runtime.compactInFlight = false;
				if (isStaleExtensionCtxError(error)) return;
				const msg = error instanceof Error ? error.message : String(error);
				if (hasUI) ui?.notify(`Observational memory: compact threw: ${msg}`, "error");
			}
		}, 0);
	});
}
