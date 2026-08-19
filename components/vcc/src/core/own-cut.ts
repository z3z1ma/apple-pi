export const LONG_ASSISTANT_CHARS = 1500;

export type CompactionReason = "manual" | "threshold" | "overflow";

export type OwnCutCancelReason = "no_live_messages" | "too_few_live_messages" | "nothing_safe_to_summarize";

export type OwnCutResult =
	| {
			ok: true;
			messages: any[];
			firstKeptEntryId: string;
			compactAll: boolean;
			messageRange?: [string, string];
	  }
	| { ok: false; reason: OwnCutCancelReason };

export type OwnCutOptions = {
	maxKeptTokens?: number;
	reason?: CompactionReason;
};

interface EntryWithMessage {
	entry: { id: string; type: string };
	message: { role: string; content: unknown };
}

const isHiddenEmptyCustomMessage = (message: unknown): boolean => {
	if (!message || typeof message !== "object") return false;
	const candidate = message as {
		role?: unknown;
		content?: unknown;
		display?: unknown;
	};
	if (candidate.role !== "custom" || candidate.display !== false) return false;
	return candidate.content === "" || (Array.isArray(candidate.content) && candidate.content.length === 0);
};

function summarizedMessageRange(summarized: EntryWithMessage[]): [string, string] | undefined {
	const firstId = summarized.find((entry) => entry.entry.id)?.entry.id;
	const lastId = [...summarized].reverse().find((entry) => entry.entry.id)?.entry.id;
	return firstId && lastId ? [firstId, lastId] : undefined;
}

function ownCutSuccess(
	summarized: EntryWithMessage[],
	firstKeptEntryId: string,
	compactAll: boolean,
): Extract<OwnCutResult, { ok: true }> {
	return {
		ok: true,
		messages: summarized.map((entry) => entry.message),
		firstKeptEntryId,
		compactAll,
		messageRange: summarizedMessageRange(summarized),
	};
}

/** Rough token estimate (chars/4) for a live message, consistent with the
 * kept-tokens estimate used by the compaction hook. */
export function estimateMessageTokens(message: { content: unknown }): number {
	const c = message.content;
	let chars = 0;
	if (typeof c === "string") {
		chars = c.length;
	} else if (Array.isArray(c)) {
		for (const part of c as any[]) {
			if (part.text) chars += part.text.length;
			else if (part.type === "toolCall") {
				const args = part.arguments ?? part.input;
				chars +=
					(part.name?.length ?? 0) + (typeof args === "string" ? args.length : JSON.stringify(args ?? "").length);
			} else if (part.type === "toolResult") {
				chars += typeof part.content === "string" ? part.content.length : JSON.stringify(part.content ?? "").length;
			} else if (part.type === "thinking") {
				chars += part.thinking?.length ?? 0;
			}
		}
	}
	return Math.ceil(chars / 4);
}

export function assistantTextChars(message: { content: unknown }): number {
	const c = message.content;
	if (typeof c === "string") return c.length;
	if (!Array.isArray(c)) return 0;
	let n = 0;
	for (const part of c as any[]) {
		if (typeof part === "string") n += part.length;
		else if (part?.type === "text" && typeof part.text === "string") n += part.text.length;
	}
	return n;
}

export function findLastDeliverableIndex(liveMessages: EntryWithMessage[]): number {
	let lastAssistant = -1;
	let lastLong = -1;
	for (let i = 0; i < liveMessages.length; i++) {
		if (liveMessages[i].message.role !== "assistant") continue;
		lastAssistant = i;
		if (assistantTextChars(liveMessages[i].message) >= LONG_ASSISTANT_CHARS) lastLong = i;
	}
	return lastLong >= 0 ? lastLong : lastAssistant;
}

function tokensFrom(liveMessages: EntryWithMessage[], start: number): number {
	let n = 0;
	for (let i = start; i < liveMessages.length; i++) {
		n += estimateMessageTokens(liveMessages[i].message);
	}
	return n;
}

/** Earliest keep index in [floor, mustKeepFrom] whose suffix includes the
 * deliverable and fits the budget. Oversize rather than move past mustKeepFrom. */
function expandKeepFrom(
	liveMessages: EntryWithMessage[],
	mustKeepFrom: number,
	floor: number,
	maxKeptTokens: number,
): number {
	if (mustKeepFrom < 0) return 0;
	const floorIdx = Math.max(0, Math.min(floor, mustKeepFrom));
	if (maxKeptTokens <= 0) return floorIdx;

	let keepFrom = mustKeepFrom;
	let used = tokensFrom(liveMessages, mustKeepFrom);
	if (used > maxKeptTokens) return mustKeepFrom;

	for (let i = mustKeepFrom - 1; i >= floorIdx; i--) {
		const next = estimateMessageTokens(liveMessages[i].message);
		if (used + next > maxKeptTokens) break;
		keepFrom = i;
		used += next;
	}
	return keepFrom;
}

function lastUserIndex(liveMessages: EntryWithMessage[]): number {
	let cutIdx = liveMessages.length - 1;
	while (cutIdx > 0 && liveMessages[cutIdx].message.role !== "user") {
		cutIdx--;
	}
	if (cutIdx < 0 || liveMessages[cutIdx].message.role !== "user") return -1;
	return cutIdx;
}

function pushBackInProgressTurn(liveMessages: EntryWithMessage[], lastUser: number): number {
	if (lastUser <= 0) return lastUser;
	const toolCallIds = new Set<string>();
	const toolResultIds = new Set<string>();
	for (let i = lastUser + 1; i < liveMessages.length; i++) {
		const msg = liveMessages[i].message;
		if (msg.role === "user") break;
		if (msg.role === "toolResult" && (msg as any).toolCallId) {
			toolResultIds.add((msg as any).toolCallId);
			continue;
		}
		const content = msg.content;
		if (typeof content === "string" || !Array.isArray(content)) continue;
		for (const part of content) {
			if (part.type === "toolCall" && part.id) toolCallIds.add(part.id);
			if (part.type === "toolResult" && part.toolCallId) toolResultIds.add(part.toolCallId);
		}
	}
	const hasUnmatchedToolCall = [...toolCallIds].some((id) => !toolResultIds.has(id));
	if (!hasUnmatchedToolCall) return lastUser;
	for (let i = lastUser - 1; i > 0; i--) {
		if (liveMessages[i].message.role === "user") return i;
	}
	return lastUser;
}

function collectLiveMessages(branchEntries: any[]): {
	liveMessages: EntryWithMessage[];
	hasValidKeptId: boolean;
	orphanRecovery: boolean;
	lastCompactionIdx: number;
} {
	let lastCompactionIdx = -1;
	let lastKeptId: string | undefined;
	for (let i = branchEntries.length - 1; i >= 0; i--) {
		if (branchEntries[i].type === "compaction") {
			lastCompactionIdx = i;
			lastKeptId = branchEntries[i].firstKeptEntryId;
			break;
		}
	}

	const hasPriorCompaction = lastCompactionIdx >= 0;
	const hasValidKeptId = !!lastKeptId && branchEntries.some((e: any) => e.id === lastKeptId);
	const orphanRecovery = hasPriorCompaction && !hasValidKeptId;

	const liveMessages: EntryWithMessage[] = [];
	if (orphanRecovery) {
		for (let i = lastCompactionIdx + 1; i < branchEntries.length; i++) {
			const e = branchEntries[i];
			if (e.type === "compaction") continue;
			if (e.type === "message" && e.message && !isHiddenEmptyCustomMessage(e.message)) {
				liveMessages.push({ entry: e, message: e.message });
			}
		}
	} else {
		let foundKept = !lastKeptId;
		for (const e of branchEntries) {
			if (!foundKept && e.id === lastKeptId) foundKept = true;
			if (!foundKept) continue;
			if (e.type === "compaction") continue;
			if (e.type === "message" && e.message && !isHiddenEmptyCustomMessage(e.message)) {
				liveMessages.push({ entry: e, message: e.message });
			}
		}
	}

	return { liveMessages, hasValidKeptId, orphanRecovery, lastCompactionIdx };
}

function hasUserAfterCompaction(branchEntries: any[], lastCompactionIdx: number): boolean {
	if (lastCompactionIdx < 0) return false;
	for (let i = lastCompactionIdx + 1; i < branchEntries.length; i++) {
		const e = branchEntries[i];
		if (e.type === "message" && e.message?.role === "user" && !isHiddenEmptyCustomMessage(e.message)) {
			return true;
		}
	}
	return false;
}

function lastAssistantIndex(liveMessages: EntryWithMessage[]): number {
	for (let i = liveMessages.length - 1; i >= 0; i--) {
		if (liveMessages[i].message.role === "assistant") return i;
	}
	return -1;
}

/** Reserved for system, tools, OM, and the compiled prefix. */
export function resolveContextOverheadTokens(contextWindow?: number): number {
	return contextWindow && contextWindow > 0 ? Math.min(32768, Math.floor(contextWindow * 0.2)) : 32768;
}

/** Compiled prefix is an index: an order of magnitude smaller than the live tail. */
export const SUMMARY_TO_KEEP_RATIO = 10;

/** Floor so a tiny compact can still keep the kickoff plus one conclusion. */
export const MIN_SUMMARY_TOKENS = 512;

/**
 * One token budget for the entire compiled artifact (headers + brief + merge).
 * min(keep/10, dropped/10, leftover overhead). Leftover overhead is half the
 * reserved overhead: system/tools/OM are not measured here and share that slice.
 */
export function resolveSummaryBudgetTokens(args: {
	maxKeptTokens: number;
	contextWindow?: number;
	droppedTokens?: number;
}): number {
	const keep = args.maxKeptTokens > 0 ? args.maxKeptTokens : 20000;
	const leftoverOverhead = Math.max(
		MIN_SUMMARY_TOKENS,
		Math.floor(resolveContextOverheadTokens(args.contextWindow) / 2),
	);
	let budget = Math.min(Math.max(MIN_SUMMARY_TOKENS, Math.floor(keep / SUMMARY_TO_KEEP_RATIO)), leftoverOverhead);
	if (args.droppedTokens != null && args.droppedTokens > 0) {
		budget = Math.min(budget, Math.max(MIN_SUMMARY_TOKENS, Math.floor(args.droppedTokens / SUMMARY_TO_KEEP_RATIO)));
	}
	return budget;
}

export function resolveMaxKeptTokens(args: {
	contextWindow?: number;
	maxTokens?: number;
	keepRecentTokens?: number;
}): number {
	const contextWindow = args.contextWindow ?? 0;
	const maxTokens = args.maxTokens ?? 0;
	const keepRecentTokens = args.keepRecentTokens ?? 20000;
	const overhead = resolveContextOverheadTokens(contextWindow || undefined);
	const outputReserve = maxTokens > 0 ? maxTokens : contextWindow > 0 ? Math.floor(contextWindow * 0.5) : 0;
	return contextWindow > 0 ? Math.max(2048, contextWindow - outputReserve - overhead) : keepRecentTokens;
}

function finishKeep(liveMessages: EntryWithMessage[], keepFrom: number): OwnCutResult {
	if (keepFrom <= 0) return { ok: false, reason: "nothing_safe_to_summarize" };
	return ownCutSuccess(liveMessages.slice(0, keepFrom), liveMessages[keepFrom].entry.id, false);
}

export function buildOwnCut(branchEntries: any[], options?: OwnCutOptions): OwnCutResult {
	const maxKeptTokens = options?.maxKeptTokens ?? 0;
	const overflow = options?.reason === "overflow";
	const { liveMessages, hasValidKeptId, orphanRecovery, lastCompactionIdx } = collectLiveMessages(branchEntries);

	if (liveMessages.length === 0) return { ok: false, reason: "no_live_messages" };
	if (liveMessages.length <= 2) return { ok: false, reason: "too_few_live_messages" };

	const lastUser = pushBackInProgressTurn(liveMessages, lastUserIndex(liveMessages));
	let deliverable = findLastDeliverableIndex(liveMessages);
	const lastAsst = lastAssistantIndex(liveMessages);
	const hasLongWriteup =
		deliverable >= 0 && assistantTextChars(liveMessages[deliverable].message) >= LONG_ASSISTANT_CHARS;
	const alreadyKeptTail =
		hasValidKeptId && !orphanRecovery && !hasUserAfterCompaction(branchEntries, lastCompactionIdx);

	if (deliverable < 0) {
		return ownCutSuccess(liveMessages, "", true);
	}

	if (overflow && maxKeptTokens > 0 && hasLongWriteup && lastAsst > deliverable) {
		if (tokensFrom(liveMessages, deliverable) > maxKeptTokens) {
			deliverable = lastAsst;
		}
	}

	if (alreadyKeptTail && !overflow) {
		return { ok: false, reason: "nothing_safe_to_summarize" };
	}

	const turnFloor = lastUser > 0 ? lastUser : 0;
	const expandFloor = deliverable < turnFloor ? 0 : turnFloor;
	let keepFrom =
		maxKeptTokens <= 0
			? deliverable < turnFloor
				? deliverable
				: turnFloor > 0
					? turnFloor
					: deliverable
			: expandKeepFrom(liveMessages, deliverable, expandFloor, maxKeptTokens);

	// Overflow must still file a prefix even when the whole live suffix fits
	// the keep budget (the overflow is in total context, not the keep estimate).
	if (overflow && keepFrom <= 0 && deliverable > 0) {
		keepFrom = deliverable;
	}

	const keptTokens = tokensFrom(liveMessages, keepFrom);
	if (
		maxKeptTokens > 0 &&
		keptTokens > maxKeptTokens &&
		!hasLongWriteup &&
		assistantTextChars(liveMessages[deliverable].message) < LONG_ASSISTANT_CHARS
	) {
		return ownCutSuccess(liveMessages, "", true);
	}

	return finishKeep(liveMessages, keepFrom);
}
