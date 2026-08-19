import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	CODEX_CONTEXT_OVERFLOW_COMPACT_INSTRUCTION,
	CODEX_OUTPUT_LIMIT_COMPACT_INSTRUCTION,
	clearCodexContextOverflowPending,
	isCodexContextOverflowError,
	isCodexOutputLimitError,
	markCodexContextOverflowPending,
} from "../core/codex-output-limit.js";
import { buildOwnCut, resolveMaxKeptTokens } from "../core/own-cut.js";
import { getModelThreshold, isPiCoreCompactionEnabled, loadSettings, resolveTriggerTokens } from "../core/settings.js";

type ProactiveContext = {
	model?: any;
	getContextUsage?: () => any;
	compact?: (options?: any) => void;
	ui?: any;
	sessionManager?: { getCwd?: () => string; getBranch?: () => unknown[] };
};

/** Pi's manual `ctx.compact()` throws if the live leaf is already a compaction. */
const branchEndsWithCompaction = (ctx: ProactiveContext): boolean => {
	const branch = ctx.sessionManager?.getBranch?.();
	if (!Array.isArray(branch) || branch.length === 0) return false;
	const last = branch[branch.length - 1];
	return !!last && typeof last === "object" && (last as { type?: unknown }).type === "compaction";
};

const formatTokens = (n: number): string => {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
};

// Cooldown after compaction to prevent double-trigger.
// Set immediately when we call ctx.compact() AND on session_compact,
// cleared after 3 seconds.
let lastCompactTime = 0;
const COOLDOWN_MS = 3000;

// Flag: when true, session_before_compact should NOT cancel even if
// tokensBefore is below the per-model threshold. This is set when
// our proactive trigger calls ctx.compact() and cleared when
// session_compact fires. It prevents the threshold guard from
// cancelling a compaction that we ourselves initiated.
let proactiveTriggerActive = false;

const setCooldown = () => {
	lastCompactTime = Date.now();
};
const isCoolingDown = () => Date.now() - lastCompactTime < COOLDOWN_MS;

/** Check if a proactive trigger is currently in flight. */
export const isProactiveTriggerActive = () => proactiveTriggerActive;

/** Reset all proactive state (for testing / session start). */
export const resetProactiveState = () => {
	lastCompactTime = 0;
	proactiveTriggerActive = false;
	clearCodexContextOverflowPending();
};

/**
 * Check if a configured threshold has been crossed and trigger compaction
 * if so. Safe to call from multiple event handlers — cooldown prevents
 * double-triggering.
 */
const checkAndTrigger = (ctx: ProactiveContext, source: string) => {
	const settings = loadSettings();
	const threshold = getModelThreshold(settings, ctx.model);

	// No threshold → nothing to do (pi-core's global threshold owns it)
	if (!threshold) return;

	const contextWindow = ctx.model?.contextWindow ?? 0;
	const effectiveThreshold = resolveTriggerTokens(threshold, contextWindow);
	if (effectiveThreshold == null) return;

	const usage = ctx.getContextUsage?.();
	if (!usage || usage.tokens === null) return;

	// This threshold's compaction trigger point.

	// Only trigger if context EXCEEDS the threshold.
	if (usage.tokens <= effectiveThreshold) return;

	// Cooldown guard — prevent double-trigger within 3s of last compaction.
	if (isCoolingDown()) return;
	if (branchEndsWithCompaction(ctx)) return;

	const branch = ctx.sessionManager?.getBranch?.();
	if (Array.isArray(branch)) {
		const preview = buildOwnCut(branch, {
			maxKeptTokens: resolveMaxKeptTokens({
				contextWindow,
				maxTokens: ctx.model?.maxTokens ?? 0,
			}),
			reason: "threshold",
		});
		if (!preview.ok) return;
	}

	try {
		const pct = Math.round((usage.tokens / contextWindow) * 100);
		ctx?.ui?.notify?.(
			`pi-vcc: [${source}] Context at ${pct}% exceeds threshold (${formatTokens(effectiveThreshold)} tok). Compacting...`,
			"info",
		);
	} catch {}

	// Set cooldown IMMEDIATELY (before ctx.compact() runs) to prevent
	// a second settled/model-switch check from also requesting compact.
	setCooldown();

	// Mark that this compaction was triggered by us, so session_before_compact
	// doesn't cancel it if tokensBefore differs from getContextUsage().
	proactiveTriggerActive = true;

	if (branchEndsWithCompaction(ctx)) {
		proactiveTriggerActive = false;
		return;
	}
	ctx.compact?.();
};

/** Force compaction for Codex responses that report an output limit as an error. */
const triggerCodexOutputLimitCompaction = (ctx: ProactiveContext) => {
	if (isCoolingDown()) return;
	if (branchEndsWithCompaction(ctx)) return;

	try {
		ctx?.ui?.notify?.("pi-vcc: Codex reached its maximum output token limit. Compacting...", "info");
	} catch {}

	setCooldown();
	proactiveTriggerActive = true;
	if (branchEndsWithCompaction(ctx)) {
		proactiveTriggerActive = false;
		return;
	}
	ctx.compact?.({ customInstructions: CODEX_OUTPUT_LIMIT_COMPACT_INSTRUCTION });
};

/** Force compaction when Codex omits the model identity from an overflow error. */
const triggerCodexContextOverflowCompaction = (ctx: ProactiveContext) => {
	if (isCoolingDown()) return;
	if (branchEndsWithCompaction(ctx)) return;

	try {
		ctx?.ui?.notify?.("pi-vcc: Codex input exceeded the context window. Compacting...", "info");
	} catch {}

	setCooldown();
	proactiveTriggerActive = true;
	if (branchEndsWithCompaction(ctx)) {
		proactiveTriggerActive = false;
		return;
	}
	ctx.compact?.({ customInstructions: CODEX_CONTEXT_OVERFLOW_COMPACT_INSTRUCTION });
};

const hasCurrentModelIdentity = (message: unknown, model: any): boolean => {
	if (!message || typeof message !== "object" || !model) return false;
	const candidate = message as { model?: unknown; provider?: unknown };
	return candidate.model === model.id && candidate.provider === model.provider;
};

const lastAssistantMessage = (event: unknown): unknown => {
	const messages = (event as any)?.messages;
	if (!Array.isArray(messages)) return undefined;

	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i]?.role === "assistant") return messages[i];
	}
	return undefined;
};

/**
 * Registers proactive configured compaction thresholds.
 *
 * Three triggers:
 *
 * 1. `agent_settled` — after retries, Pi auto-compaction, and queued
 *    continuation have finished. If context still exceeds the configured
 *    threshold, request compact. This is later than `agent_end` so a
 *    fire-and-forget `ctx.compact()` cannot race Pi's `_checkCompaction`.
 *    Codex overflow/output-limit recovery stays on `agent_end` because
 *    those errors have no usable usage snapshot.
 *
 * 2. `model_select` — when switching models, the new model may have a
 *    different threshold. Check immediately in case current context exceeds
 *    the new threshold.
 *
 * 3. `session_compact` — cooldown tracking + clear proactiveTriggerActive.
 *    After any compaction completes, we set a cooldown to prevent
 *    double-triggering and clear the self-initiated flag.
 *
 * `session_before_compact` reads `isProactiveTriggerActive()` to decide
 * whether to cancel. When our proactive trigger fires, ctx.compact() is
 * queued but hasn't run yet. By the time session_before_compact actually
 * fires, tokensBefore may differ from the getContextUsage() snapshot
 * that triggered the compact. Without the flag, the threshold guard would
 * cancel the compaction we ourselves requested — producing confusing
 * "Compacting..." then "Skipped compaction" notifications.
 */
export const registerProactiveThresholdHook = (pi: ExtensionAPI) => {
	// Codex reports output-limit responses as errors instead of the standard
	// "length" stop reason. Those errors have no usable context usage, so
	// pi-core cannot discover the need to compact from its normal checks.
	// Context-window errors are tracked separately because pi-core already
	// recognizes and compacts those.
	pi.on("agent_end", (event, ctx) => {
		const lastMessage = lastAssistantMessage(event);
		if (isCodexOutputLimitError(lastMessage)) {
			triggerCodexOutputLimitCompaction(ctx);
			return;
		}
		if (isCodexContextOverflowError(lastMessage)) {
			markCodexContextOverflowPending();
			// pi-core's overflow compaction only fires when compaction is enabled AND
			// the assistant message carries the current model identity. If either
			// is missing pi-core bails (or its LLM compaction would re-overflow), so
			// pi-vcc must drive the recovery compaction itself via ctx.compact(),
			// whose manual path skips the `enabled` gate and uses pi-vcc's static
			// summary. When pi-core will handle it, defer to avoid a racing second
			// compaction that would abort pi-core's own retry.
			const piCoreWillHandle =
				hasCurrentModelIdentity(lastMessage, ctx.model) && isPiCoreCompactionEnabled(ctx.sessionManager?.getCwd?.());
			if (!piCoreWillHandle) {
				triggerCodexContextOverflowCompaction(ctx);
			}
		}
	});

	// Usage waterline — after Pi has had its chance to compact.
	pi.on("agent_settled", (_event, ctx) => {
		checkAndTrigger(ctx, "auto");
	});

	// Proactive compaction on model switch
	pi.on("model_select", (_event, ctx) => {
		checkAndTrigger(ctx, "model-switch");
	});

	// Track compaction completion: set cooldown and clear self-initiated flag
	pi.on("session_compact", () => {
		setCooldown();
		proactiveTriggerActive = false;
		clearCodexContextOverflowPending();
	});

	// Reset state on session start so state doesn't leak between sessions
	pi.on("session_start", () => {
		lastCompactTime = 0;
		proactiveTriggerActive = false;
		clearCodexContextOverflowPending();
	});
};
