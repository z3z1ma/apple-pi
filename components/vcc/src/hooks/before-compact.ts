import { writeFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	CODEX_CONTEXT_OVERFLOW_COMPACT_INSTRUCTION,
	CODEX_OUTPUT_LIMIT_COMPACT_INSTRUCTION,
	clearCodexContextOverflowPending,
	isCodexContextOverflowError,
	isCodexContextOverflowPending,
	isCodexOutputLimitError,
} from "../core/codex-output-limit.js";
import { countPiVccCompactionsFromSession, ordinalSuffix } from "../core/compaction-count.js";
import { triggerInvisibleContinue } from "../core/invisible-continue.js";
import {
	buildOwnCut,
	type CompactionReason,
	estimateMessageTokens,
	type OwnCutCancelReason,
	resolveMaxKeptTokens,
	resolveSummaryBudgetTokens,
} from "../core/own-cut.js";
import { loadSettings, type PiVccSettings } from "../core/settings.js";
import { type CompileInput, compile } from "../core/summarize.js";
import type { PiVccCompactionDetails } from "../details.js";
import { isProactiveTriggerActive } from "./proactive-threshold.js";

export {
	assistantTextChars,
	buildOwnCut,
	type CompactionReason,
	findLastDeliverableIndex,
	LONG_ASSISTANT_CHARS,
	type OwnCutCancelReason,
	type OwnCutOptions,
	type OwnCutResult,
	resolveMaxKeptTokens,
	resolveSummaryBudgetTokens,
} from "../core/own-cut.js";

export const PI_VCC_COMPACT_INSTRUCTION = "__pi_vcc__";

export interface CompactionStats {
	summarized: number;
	kept: number;
	keptTokensEst: number;
}

export interface VccCompactionAugmentationInput {
	branchEntries: any[];
	firstKeptEntryId: string;
	cwd: string;
}

export interface VccCompactionAugmentation {
	summary?: string;
	details?: Record<string, unknown>;
}

export type VccCompactionAugmenter = (input: VccCompactionAugmentationInput) => VccCompactionAugmentation | undefined;

interface CompactionHookState {
	lastStats: CompactionStats | null;
	lastCompactWasPiVcc: boolean;
	lastCompactWasCodexRecovery: boolean;
	lastCompactWasProactive: boolean;
	lastCompactHandledByVcc: boolean;
}

function createCompactionHookState(): CompactionHookState {
	return {
		lastStats: null,
		lastCompactWasPiVcc: false,
		lastCompactWasCodexRecovery: false,
		lastCompactWasProactive: false,
		lastCompactHandledByVcc: false,
	};
}

export type CompactionStatsGetter = () => CompactionStats | null;

const formatTokens = (n: number): string => {
	if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
	return String(n);
};

const dbg = (settings: PiVccSettings, data: Record<string, unknown>) => {
	if (!settings.debug) return;
	try {
		writeFileSync("/tmp/pi-vcc-debug.json", JSON.stringify(data, null, 2));
	} catch {}
};

const previewContent = (content: unknown): string => {
	if (typeof content === "string") return content.slice(0, 300);
	if (Array.isArray(content)) {
		return content
			.map((c: any) => {
				if (c?.type === "text") return c.text ?? "";
				if (c?.type === "toolCall") return `[toolCall:${c.name}]`;
				if (c?.type === "thinking") return `[thinking]`;
				if (c?.type === "image") return `[image:${c.mimeType}]`;
				return `[${c?.type ?? "unknown"}]`;
			})
			.join("\n")
			.slice(0, 300);
	}
	return "";
};

const REASON_MESSAGES: Record<OwnCutCancelReason, string> = {
	no_live_messages: "pi-vcc: Nothing to compact (no live messages)",
	too_few_live_messages: "pi-vcc: Too few messages to compact",
	nothing_safe_to_summarize: "pi-vcc: Nothing safe to compact without dropping the latest deliverable",
};

export const shouldResumeAfterCompaction = (lastMsg: unknown, allowCodexRecovery = false): boolean => {
	if (!lastMsg || typeof lastMsg !== "object") return false;
	const message = lastMsg as { role?: unknown; stopReason?: unknown };
	if (message.role !== "assistant") return false;
	if (message.stopReason === "stop" || message.stopReason === "aborted") return false;
	if (message.stopReason === "error") {
		return allowCodexRecovery && (isCodexOutputLimitError(lastMsg) || isCodexContextOverflowError(lastMsg));
	}
	return true;
};

export type CompactionCompletionMetadata = {
	reason?: "manual" | "threshold" | "overflow";
	willRetry?: boolean;
};

export function shouldTriggerResumeForCompaction(
	event: CompactionCompletionMetadata,
	sessionIsIdle: boolean,
	wasProactiveCompaction: boolean,
	wasCodexRecoveryCompaction: boolean,
): boolean {
	if (event.willRetry) return true;
	if (wasCodexRecoveryCompaction || wasProactiveCompaction) return true;
	if (event.reason === "manual" || event.reason === "overflow") return false;
	if (event.reason === "threshold") return !sessionIsIdle;

	// Pi before 0.79.10 did not expose compaction reason metadata. Be
	// conservative there: an idle session may be manual or pre-prompt.
	return !sessionIsIdle;
}

export const registerBeforeCompactHook = (
	pi: ExtensionAPI,
	augmentCompaction?: VccCompactionAugmenter,
): CompactionStatsGetter => {
	const state = createCompactionHookState();
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: the hook coordinates one atomic compaction lifecycle.
	pi.on("session_before_compact", (event, ctx) => {
		const { preparation, branchEntries, customInstructions } = event;
		const settings = loadSettings();

		// Per-model threshold guard was previously applied here, cancelling
		// compaction when context was below the per-model threshold. This
		// blocked manual /compact from working because session_before_compact
		// carries no "reason" field — manual and auto compactions are
		// indistinguishable (both have customInstructions: undefined).
		//
		// The per-model threshold is now served entirely by the proactive
		// trigger (in proactive-threshold.ts), which fires on agent_settled /
		// model_select when the per-model threshold is crossed. This correctly
		// compacts earlier than pi-core's global threshold without needing to
		// cancel any compaction here.
		//
		// If pi-core's global threshold fires before the per-model threshold
		// is crossed, the compaction proceeds — slightly premature from the
		// per-model threshold's perspective, but this is preferable to blocking
		// an explicit user action (/compact).
		const isPiVcc = customInstructions === PI_VCC_COMPACT_INSTRUCTION;
		const isCodexOutputLimitCompaction = customInstructions === CODEX_OUTPUT_LIMIT_COMPACT_INSTRUCTION;
		const isCodexContextOverflowMarker = customInstructions === CODEX_CONTEXT_OVERFLOW_COMPACT_INSTRUCTION;
		const lastBranchAssistant = [...(branchEntries as any[])]
			.reverse()
			.find((entry: any) => entry.type === "message" && entry.message?.role === "assistant")?.message;
		const isCodexContextOverflowCompaction =
			isCodexContextOverflowMarker ||
			(settings.overrideDefaultCompaction &&
				isCodexContextOverflowPending() &&
				isCodexContextOverflowError(lastBranchAssistant));
		const isPiVccHandled = isPiVcc || isCodexOutputLimitCompaction || isCodexContextOverflowCompaction;

		// Always handle explicit /pi-vcc and Codex recovery markers. Otherwise,
		// only handle when the user opted in via settings.
		if (!isPiVccHandled && !settings.overrideDefaultCompaction) return;
		if (isCodexContextOverflowCompaction) clearCodexContextOverflowPending();

		// Budget the kept tail so that summary + kept + system/tools + the model's
		// OUTPUT budget (maxTokens) all fit in the window. Without reserving
		// maxTokens, the compaction-retry request can be rejected upfront
		// (input + maxTokens > contextWindow) and re-overflow. Falls back to
		// pi-core's keepRecentTokens when the window is unknown.
		const maxKeptTokens = resolveMaxKeptTokens({
			contextWindow: (ctx as any)?.model?.contextWindow ?? 0,
			maxTokens: (ctx as any)?.model?.maxTokens ?? 0,
			keepRecentTokens: (preparation as any)?.settings?.keepRecentTokens ?? 20000,
		});
		const eventReason = (event as { reason?: CompactionReason }).reason;
		const ownCut = buildOwnCut(branchEntries as any[], {
			maxKeptTokens,
			reason: isCodexOutputLimitCompaction || isCodexContextOverflowCompaction ? "overflow" : eventReason,
		});
		if (!ownCut.ok) {
			const lastComp = [...branchEntries].reverse().find((e: any) => e.type === "compaction");
			const lastCompIdx = lastComp ? (branchEntries as any[]).indexOf(lastComp) : -1;

			// Recompute liveMessages view (same logic as buildOwnCut) for diagnostic
			const lastKeptId: string | undefined = (lastComp as any)?.firstKeptEntryId;
			const hasPriorCompaction = lastCompIdx >= 0;
			const hasValidKeptId = !!lastKeptId && (branchEntries as any[]).some((e: any) => e.id === lastKeptId);
			const diagOrphan = hasPriorCompaction && !hasValidKeptId;
			const liveRoles: string[] = [];
			if (diagOrphan) {
				for (let i = lastCompIdx + 1; i < branchEntries.length; i++) {
					const e = (branchEntries as any[])[i];
					if (e.type === "compaction") continue;
					if (e.type === "message" && e.message) liveRoles.push(e.message.role);
				}
			} else {
				let foundKept = !lastKeptId;
				for (const e of branchEntries as any[]) {
					if (!foundKept && e.id === lastKeptId) foundKept = true;
					if (!foundKept) continue;
					if (e.type === "compaction") continue;
					if (e.type === "message" && e.message) liveRoles.push(e.message.role);
				}
			}
			const userIndices = liveRoles.flatMap((role, index) => (role === "user" ? [index] : []));

			dbg(settings, {
				cancelled: true,
				reason: ownCut.reason,
				isPiVcc,
				counts: {
					total: branchEntries.length,
					messages: (branchEntries as any[]).filter((e: any) => e.type === "message").length,
					compactions: (branchEntries as any[]).filter((e: any) => e.type === "compaction").length,
					entriesAfterLastCompaction: lastCompIdx >= 0 ? branchEntries.length - lastCompIdx - 1 : null,
				},
				liveMessages: {
					count: liveRoles.length,
					userCount: userIndices.length,
					firstUserIdx: userIndices[0] ?? null,
					lastUserIdx: userIndices[userIndices.length - 1] ?? null,
					roleSequence:
						liveRoles.length <= 30 ? liveRoles : [...liveRoles.slice(0, 10), "...", ...liveRoles.slice(-10)],
				},
				lastCompaction: lastComp
					? {
							hasFirstKeptEntryId: !!(lastComp as any).firstKeptEntryId,
							foundInBranch: (lastComp as any).firstKeptEntryId
								? (branchEntries as any[]).some((e: any) => e.id === (lastComp as any).firstKeptEntryId)
								: null,
						}
					: null,
				tail: (branchEntries as any[]).slice(-5).map((e: any) => ({
					type: e.type,
					role: e.type === "message" ? e.message?.role : undefined,
					hasContent: e.type === "message" ? e.message?.content != null : undefined,
				})),
			});

			try {
				ctx?.ui?.notify?.(REASON_MESSAGES[ownCut.reason], "warning");
			} catch {}
			return { cancel: true };
		}

		const agentMessages = ownCut.messages;
		const firstKeptEntryId = ownCut.firstKeptEntryId;
		const messages = agentMessages;

		// Count kept messages and estimate tokens
		const keptIdx = (branchEntries as any[]).findIndex((e: any) => e.id === firstKeptEntryId);
		const keptEntries =
			keptIdx >= 0 ? (branchEntries as any[]).slice(keptIdx).filter((e: any) => e.type === "message") : [];
		const keptChars = keptEntries.reduce((sum: number, e: any) => {
			const c = e.message?.content;
			if (typeof c === "string") return sum + c.length;
			if (Array.isArray(c))
				return (
					sum +
					c.reduce((s: number, p: any) => {
						if (p.text) return s + p.text.length;
						if (p.type === "toolCall")
							return (
								s +
								(p.name?.length ?? 0) +
								(typeof p.input === "string" ? p.input.length : JSON.stringify(p.input ?? "").length)
							);
						if (p.type === "toolResult")
							return s + (typeof p.content === "string" ? p.content.length : JSON.stringify(p.content ?? "").length);
						return s;
					}, 0)
				);
			return sum;
		}, 0);
		state.lastStats = {
			summarized: agentMessages.length,
			kept: keptEntries.length,
			keptTokensEst: Math.round(keptChars / 4),
		};

		const config = settings;

		const messageRange = ownCut.messageRange;

		const droppedTokens = messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
		const compileInput: CompileInput = {
			messages,
			previousSummary: preparation.previousSummary,
			fileOps: {
				readFiles: [...preparation.fileOps.read],
				modifiedFiles: [...preparation.fileOps.written, ...preparation.fileOps.edited],
			},
			budgetTokens: resolveSummaryBudgetTokens({
				maxKeptTokens,
				contextWindow: (ctx as any)?.model?.contextWindow ?? 0,
				droppedTokens,
			}),
		};

		let summary = compile(compileInput);

		const branchIds = branchEntries.map((e: any) => e.id);
		const cutIdx = branchIds.indexOf(firstKeptEntryId);
		const cutWindow =
			cutIdx >= 0
				? branchEntries.slice(Math.max(0, cutIdx - 3), Math.min(branchEntries.length, cutIdx + 3)).map((e: any) => ({
						id: e.id,
						type: e.type,
						role: e.type === "message" ? e.message?.role : undefined,
						preview: e.type === "message" ? previewContent(e.message?.content) : undefined,
					}))
				: [];

		dbg(config, {
			usedOwnCut: true,
			messagesToSummarize: agentMessages.length,
			messagesPreviewHead: agentMessages
				.slice(0, 3)
				.map((m: any) => ({ role: m.role, preview: previewContent(m.content) })),
			messagesPreviewTail: agentMessages
				.slice(-3)
				.map((m: any) => ({ role: m.role, preview: previewContent(m.content) })),
			convertedMessages: messages.length,
			firstKeptEntryId,
			messageRange,
			cutWindow,
			tokensBefore: preparation.tokensBefore,
			summaryLength: summary.length,
			summaryPreview: summary.slice(0, 500),
			sections: [...summary.matchAll(/^\[(.+?)\]/gm)].map((m) => m[1]),
		});

		const sections = [...summary.matchAll(/^\[(.+?)\]/gm)].map((m) => m[1]);
		const details: PiVccCompactionDetails = {
			compactor: "pi-vcc",
			version: 1,
			sections,
			sourceMessageCount: agentMessages.length,
			previousSummaryUsed: Boolean(preparation.previousSummary),
			messageRange,
			compressionRatio:
				preparation.tokensBefore > 0
					? Math.round(preparation.tokensBefore / Math.max(1, agentMessages.length))
					: undefined,
			timestamp: new Date().toISOString(),
			tokensBefore: preparation.tokensBefore || undefined,
			keptCount: state.lastStats?.kept || undefined,
			keptTokensEst: state.lastStats?.keptTokensEst || undefined,
		};
		const augmentation = augmentCompaction?.({
			branchEntries: branchEntries as any[],
			firstKeptEntryId,
			cwd: ctx.cwd,
		});
		if (augmentation?.summary) {
			summary = summary ? `${summary}\n\n${augmentation.summary}` : augmentation.summary;
		}
		// The details stay flat by design. VCC recall identifies `compactor`, while
		// observational memory identifies `type`; preserving both top-level tags
		// lets each projection read the same compaction entry without a wrapper.
		const combinedDetails = augmentation?.details ? { ...details, ...augmentation.details } : details;

		state.lastCompactWasPiVcc = isPiVcc;
		state.lastCompactWasCodexRecovery = isCodexOutputLimitCompaction || isCodexContextOverflowCompaction;
		state.lastCompactWasProactive = isProactiveTriggerActive();
		state.lastCompactHandledByVcc = true;

		// Signal to neuralwatt-mcr that pi-vcc is handling compaction
		// so it doesn't cancel the event. Without this flag, neuralwatt-mcr
		// returns { cancel: true } for MCR models and pi-vcc's summary is
		// discarded by the runner's short-circuit.
		(event as any)._piVccOverriding = true;

		return {
			compaction: {
				summary,
				details: combinedDetails,
				tokensBefore: preparation.tokensBefore,
				firstKeptEntryId,
			},
		};
	});

	// After compaction completes, check if the agent loop stalled and needs
	// an invisible continue to resume.  This handles threshold compaction
	// where willRetry=false — pi-core doesn't auto-retry, and the agent loop
	// exits because hasQueuedMessages() returns false.  If the last message in
	// the rebuilt context is an assistant mid-task (tool_use, length, or error
	// that isn't a clean end_turn), the agent was interrupted and should
	// continue.
	pi.on("session_compact", (event, ctx) => {
		if (!state.lastCompactHandledByVcc) return;
		const wasCodexRecoveryCompaction = state.lastCompactWasCodexRecovery;
		const wasProactiveCompaction = state.lastCompactWasProactive;
		state.lastCompactHandledByVcc = false;
		state.lastCompactWasCodexRecovery = false;
		state.lastCompactWasProactive = false;

		// Fire success toast for pi-vcc's /compact path only (delayed to let UI
		// settle). /pi-vcc has its own callback.
		if (!state.lastCompactWasPiVcc) {
			const stats = state.lastStats;
			const count = countPiVccCompactionsFromSession(ctx?.sessionManager as any);
			const compactionLabel = count > 0 ? ` (${count}${ordinalSuffix(count)} compaction)` : "";
			if (stats) {
				setTimeout(() => {
					try {
						ctx?.ui?.notify?.(
							`pi-vcc: ${stats.summarized} source entries processed; tail kept ${stats.kept} (~${formatTokens(stats.keptTokensEst)} tok).${compactionLabel}`,
							"info",
						);
					} catch {}
				}, 500);
			}
		}

		// Determine if the agent needs to continue after compaction.
		// After rebuildSessionContext, the agent's state.messages are updated.
		// Check the last message: if it's an assistant message that isn't a
		// clean stop, the agent was mid-task and needs to resume.
		//
		// We do NOT continue when:
		// - Last message is user/toolResult (agent can continue naturally)
		// - Last message is assistant with stopReason=stop (task finished)
		// - Last message is assistant with stopReason=aborted (user cancelled)
		// - Last message is assistant with stopReason=error, unless this was
		//   a pi-vcc Codex recovery compaction
		//
		// We DO continue when:
		// - Last message is assistant with stopReason=toolUse (mid-tool cycle)
		// - Last message is assistant with stopReason=length (hit max tokens)
		// - Last message is a known Codex recovery error from the pi-vcc
		//   recovery compaction
		// - Compact-all (firstKeptEntryId="") — context is just the summary,
		//   the agent needs to re-enter the loop to continue the task
		try {
			const entries = ctx.sessionManager.getEntries();
			// Walk backwards to find the last message entry
			let lastMsg: { role: string; stopReason?: string; content?: unknown } | undefined;
			for (let i = entries.length - 1; i >= 0; i--) {
				const e = (entries as any[])[i];
				if (e.type === "message" && e.message) {
					lastMsg = e.message;
					break;
				}
			}
			// A core-owned retry also gets a marker. Agent.continue() drains the
			// queued marker before checking the assistant-tail role, so no Agent
			// prototype fallback is needed.
			const completion = event as CompactionCompletionMetadata;
			const legacyActiveCompaction =
				completion.reason === undefined && completion.willRetry === undefined && !ctx.isIdle();
			if (
				!completion.willRetry &&
				!legacyActiveCompaction &&
				!shouldResumeAfterCompaction(lastMsg, wasCodexRecoveryCompaction)
			)
				return;
			if (
				!shouldTriggerResumeForCompaction(completion, ctx.isIdle(), wasProactiveCompaction, wasCodexRecoveryCompaction)
			)
				return;

			// Queue through Pi's native follow-up path so a concurrent user prompt
			// wins cleanly instead of racing a low-level Agent.prompt([]) call.
			triggerInvisibleContinue(pi);
		} catch {
			// Non-critical — if context inspection fails, don't block compaction
		}
	});
	return () => state.lastStats;
};
