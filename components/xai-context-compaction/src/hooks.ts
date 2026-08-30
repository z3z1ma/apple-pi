import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import { convertMessagesForXaiCompaction, isXaiResponsesModel } from "./convert.js";
import { injectXaiCompaction } from "./inject.js";
import type { XaiCompactionItem } from "./types.js";

const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";
const FALLBACK_PROJECTION_CHARS = 12_000;
const FALLBACK_PROJECTION_MESSAGES = 24;
const FALLBACK_PRIOR_SUMMARY_CHARS = 4_000;

type BranchEntry = {
	type?: unknown;
	details?: unknown;
	summary?: unknown;
};

export function findLatestXaiCompaction(branchEntries: BranchEntry[]): XaiCompactionItem | undefined {
	for (let i = branchEntries.length - 1; i >= 0; i--) {
		const entry = branchEntries[i];
		if (entry?.type !== "compaction") continue;
		const item = (entry.details as { xaiCompaction?: XaiCompactionItem } | undefined)?.xaiCompaction;
		if (item?.type === "compaction" && item.id && item.encrypted_content) return item;
	}
	return undefined;
}

function findLatestCompactionSummary(branchEntries: BranchEntry[]): string | undefined {
	for (let i = branchEntries.length - 1; i >= 0; i--) {
		const entry = branchEntries[i];
		if (entry?.type === "compaction" && typeof entry.summary === "string") return entry.summary;
	}
	return undefined;
}

function compactEndpoint(model: { baseUrl?: string }, authBaseUrl?: string): string {
	const baseUrl = (authBaseUrl || model.baseUrl || DEFAULT_XAI_BASE_URL).replace(/\/+$/, "");
	return `${baseUrl}/responses/compact`;
}

function excerpt(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	const headChars = Math.ceil((maxChars - 32) * 0.6);
	const tailChars = maxChars - 32 - headChars;
	return `${text.slice(0, headChars)}\n… [middle omitted] …\n${text.slice(-tailChars)}`;
}

function projectionIndices(messageCount: number): number[] {
	if (messageCount <= FALLBACK_PROJECTION_MESSAGES) return Array.from({ length: messageCount }, (_, index) => index);

	const recentCount = Math.floor(FALLBACK_PROJECTION_MESSAGES * 0.7);
	const historicalCount = FALLBACK_PROJECTION_MESSAGES - recentCount;
	const historyEnd = messageCount - recentCount;
	const historical = Array.from({ length: historicalCount }, (_, index) =>
		Math.floor((index * historyEnd) / historicalCount),
	);
	return [...historical, ...Array.from({ length: recentCount }, (_, index) => historyEnd + index)];
}

/**
 * A bounded local projection remains usable when xAI's opaque item cannot be replayed.
 * It samples the whole compacted history, keeps recent messages verbatim where possible,
 * and preserves both ends of long individual messages.
 */
export function fallbackSummary(compactionId: string, messages: AgentMessage[], previousSummary?: string): string {
	const indices = projectionIndices(messages.length);
	const omittedCount = messages.length - indices.length;
	const header = `[xAI Server-Side Compaction ${compactionId}]\n\nText fallback for ${messages.length} compacted messages.\n`;
	const priorContext = previousSummary
		? `\n--- Prior compacted context ---\n${excerpt(previousSummary, FALLBACK_PRIOR_SUMMARY_CHARS)}\n`
		: "";
	const omission = omittedCount > 0 ? `[${omittedCount} messages are represented by the sampled history below.]\n` : "";
	const availableChars = FALLBACK_PROJECTION_CHARS - header.length - priorContext.length - omission.length;
	const charsPerMessage = Math.max(64, Math.floor(availableChars / Math.max(1, indices.length)) - 64);
	const projection = indices
		.map((index) => {
			const text = serializeConversation(convertToLlm([messages[index]!])).trim();
			return `\n--- Compacted message ${index + 1}/${messages.length} ---\n${excerpt(text, charsPerMessage)}`;
		})
		.join("");

	return `${header}${priorContext}${omission}${projection}`.slice(0, FALLBACK_PROJECTION_CHARS);
}

function parseCompactionItem(data: unknown): XaiCompactionItem | undefined {
	if (data === null || typeof data !== "object") return undefined;
	const output = (data as { output?: unknown }).output;
	if (!Array.isArray(output)) return undefined;
	const item = output.find(
		(entry) => typeof entry === "object" && entry !== null && (entry as { type?: unknown }).type === "compaction",
	) as { id?: unknown; encrypted_content?: unknown } | undefined;
	if (typeof item?.id !== "string" || typeof item.encrypted_content !== "string") return undefined;
	return { type: "compaction", id: item.id, encrypted_content: item.encrypted_content };
}

function authHeaders(headers: Record<string, string | null> | undefined): Record<string, string> {
	const resolved: Record<string, string> = {};
	if (!headers) return resolved;
	for (const [key, value] of Object.entries(headers)) {
		if (typeof value === "string") resolved[key] = value;
	}
	return resolved;
}

export async function compactWithXai(event: SessionBeforeCompactEvent, ctx: ExtensionContext) {
	const model = ctx.model;
	if (!model || !isXaiResponsesModel(model)) return undefined;

	const registry = ctx.modelRegistry;
	if (typeof registry?.getApiKeyAndHeaders !== "function") return undefined;

	let authResolution: Awaited<ReturnType<typeof registry.getApiKeyAndHeaders>>;
	try {
		authResolution = await registry.getApiKeyAndHeaders(model);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		ctx.ui?.notify?.(`xAI context compaction skipped: ${message}`, "warning");
		return undefined;
	}
	if (!authResolution.ok) {
		ctx.ui?.notify?.(`xAI context compaction skipped: ${authResolution.error}`, "warning");
		return undefined;
	}

	const previousCompaction = findLatestXaiCompaction((event.branchEntries ?? []) as BranchEntry[]);
	const messagesToCompact = [
		...(event.preparation.messagesToSummarize ?? []),
		...(event.preparation.turnPrefixMessages ?? []),
	] as AgentMessage[];
	const input = convertMessagesForXaiCompaction(messagesToCompact, previousCompaction);

	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		...authHeaders(authResolution.headers),
	};
	if (authResolution.apiKey) headers.Authorization = `Bearer ${authResolution.apiKey}`;

	try {
		const response = await fetch(compactEndpoint(model, authResolution.baseUrl), {
			method: "POST",
			headers,
			body: JSON.stringify({ model: model.id, input }),
			signal: event.signal,
		});
		if (!response.ok) {
			const errorBody = await response.text();
			ctx.ui?.notify?.(
				`xAI compaction endpoint returned HTTP ${response.status}: ${errorBody.slice(0, 200)}`,
				"warning",
			);
			return undefined;
		}

		const compactionItem = parseCompactionItem(await response.json());
		if (!compactionItem) {
			ctx.ui?.notify?.("xAI compaction endpoint returned no compaction item; using standard compaction.", "warning");
			return undefined;
		}

		return {
			compaction: {
				summary: fallbackSummary(
					compactionItem.id,
					messagesToCompact,
					event.preparation.previousSummary ??
						findLatestCompactionSummary((event.branchEntries ?? []) as BranchEntry[]),
				),
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: {
					xaiCompaction: compactionItem,
					tokensBefore: event.preparation.tokensBefore,
				},
			},
		};
	} catch (err) {
		if (!event.signal?.aborted) {
			const message = err instanceof Error ? err.message : String(err);
			ctx.ui?.notify?.(`xAI compaction failed (${message}), falling back to standard compaction`, "warning");
		}
		return undefined;
	}
}

/** Replay the newest opaque item and disable injection only after an attributable 4xx. No compact hook. */
export function registerXaiCompactionReplayHooks(pi: ExtensionAPI): void {
	let compactionDisabledForSession = false;
	let outstandingRequests = 0;
	let soleOutstandingRequestWasInjected = false;
	let overlapAmbiguous = false;

	const clearOutstanding = () => {
		outstandingRequests = 0;
		soleOutstandingRequestWasInjected = false;
		overlapAmbiguous = false;
	};

	pi.on("session_start", () => {
		compactionDisabledForSession = false;
		clearOutstanding();
	});
	pi.on("agent_end", clearOutstanding);
	pi.on("model_select", clearOutstanding);
	pi.on("session_shutdown", () => {
		compactionDisabledForSession = false;
		clearOutstanding();
	});

	pi.on("after_provider_response", (event, ctx) => {
		// The extension API does not correlate responses to requests. A rejection is
		// attributable only while our injected request is the sole request in flight.
		const attributable = outstandingRequests === 1 && soleOutstandingRequestWasInjected && !overlapAmbiguous;
		if (attributable && event.status >= 400 && event.status < 500) {
			compactionDisabledForSession = true;
			ctx.ui?.notify?.(
				`xAI server-side compaction item rejected by provider (HTTP ${event.status}); falling back to the text summary for this session. This turn still fails.`,
				"warning",
			);
		}
		outstandingRequests = Math.max(0, outstandingRequests - 1);
		if (outstandingRequests === 0) {
			soleOutstandingRequestWasInjected = false;
			overlapAmbiguous = false;
		}
	});

	pi.on("before_provider_request", (event, ctx) => {
		const wasOnlyOutstandingRequest = outstandingRequests === 0;
		outstandingRequests++;
		if (!wasOnlyOutstandingRequest) overlapAmbiguous = true;

		if (compactionDisabledForSession || !isXaiResponsesModel(ctx.model)) return undefined;

		const latestCompaction = findLatestXaiCompaction((ctx.sessionManager?.getBranch?.() ?? []) as BranchEntry[]);
		if (!latestCompaction) return undefined;

		const modified = injectXaiCompaction(event.payload, ctx.model, latestCompaction);
		// A pre-existing opaque item is not evidence that this extension injected it.
		if (wasOnlyOutstandingRequest && modified !== undefined) soleOutstandingRequestWasInjected = true;
		else soleOutstandingRequestWasInjected = false;
		return modified;
	});
}

export function registerXaiCompactionHooks(pi: ExtensionAPI): void {
	registerXaiCompactionReplayHooks(pi);
	pi.on("session_before_compact", async (event, ctx) => compactWithXai(event, ctx));
}
