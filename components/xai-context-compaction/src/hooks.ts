import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import { convertMessagesForXaiCompaction, isXaiResponsesModel } from "./convert.js";
import { injectXaiCompaction, payloadHasXaiCompaction } from "./inject.js";
import type { XaiCompactionItem } from "./types.js";

const DEFAULT_XAI_BASE_URL = "https://api.x.ai/v1";
const FALLBACK_EXCERPT_CHARS = 2_000;

type BranchEntry = {
	type?: unknown;
	details?: unknown;
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

function compactEndpoint(model: { baseUrl?: string }, authBaseUrl?: string): string {
	const baseUrl = (authBaseUrl || model.baseUrl || DEFAULT_XAI_BASE_URL).replace(/\/+$/, "");
	return `${baseUrl}/responses/compact`;
}

function fallbackSummary(compactionId: string, messages: AgentMessage[]): string {
	const conversationText = serializeConversation(convertToLlm(messages));
	const tailText =
		conversationText.length > FALLBACK_EXCERPT_CHARS
			? conversationText.slice(-FALLBACK_EXCERPT_CHARS)
			: conversationText;
	return `[xAI Server-Side Compaction ${compactionId}]\n\nSummarized ${messages.length} messages.\n\nRecent context:\n${tailText}`;
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
				summary: fallbackSummary(compactionItem.id, messagesToCompact),
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

/** Replay the newest opaque item and disable injection after a 4xx. No compact hook. */
export function registerXaiCompactionReplayHooks(pi: ExtensionAPI): void {
	let compactionDisabledForSession = false;
	let lastRequestCarriedCompaction = false;

	pi.on("session_start", () => {
		compactionDisabledForSession = false;
		lastRequestCarriedCompaction = false;
	});

	pi.on("after_provider_response", (event, ctx) => {
		if (lastRequestCarriedCompaction && event.status >= 400 && event.status < 500) {
			compactionDisabledForSession = true;
			ctx.ui?.notify?.(
				`xAI server-side compaction item rejected by provider (HTTP ${event.status}); falling back to the text summary for this session. This turn still fails.`,
				"warning",
			);
		}
		lastRequestCarriedCompaction = false;
	});

	pi.on("before_provider_request", (event, ctx) => {
		if (compactionDisabledForSession || !isXaiResponsesModel(ctx.model)) return undefined;

		const latestCompaction = findLatestXaiCompaction((ctx.sessionManager?.getBranch?.() ?? []) as BranchEntry[]);
		if (!latestCompaction) return undefined;

		if (payloadHasXaiCompaction(event.payload, latestCompaction)) {
			lastRequestCarriedCompaction = true;
			return undefined;
		}

		const modified = injectXaiCompaction(event.payload, ctx.model, latestCompaction);
		if (modified !== undefined) lastRequestCarriedCompaction = true;
		return modified;
	});
}

export function registerXaiCompactionHooks(pi: ExtensionAPI): void {
	registerXaiCompactionReplayHooks(pi);
	pi.on("session_before_compact", async (event, ctx) => compactWithXai(event, ctx));
}
