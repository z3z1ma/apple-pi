import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Tool } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext, SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@earendil-works/pi-coding-agent";
import { compactWithAnthropic, injectAnthropicCompaction } from "./anthropic.js";
import { compactInRequest, compactWithResponses, injectResponsesCompaction } from "./responses.js";
import { compactionMatchesModel, serverCompactionMethod } from "./target.js";
import type { ServerCompaction } from "./types.js";

const FALLBACK_PROJECTION_CHARS = 12_000;
const FALLBACK_PROJECTION_MESSAGES = 24;
const FALLBACK_PRIOR_SUMMARY_CHARS = 4_000;

type BranchEntry = {
	type?: unknown;
	details?: unknown;
	summary?: unknown;
};

/** Only the newest compaction entry counts: an older server result never outlives a later summary. */
export function findLatestServerCompaction(
	branchEntries: BranchEntry[],
): { compaction: ServerCompaction; summary?: string } | undefined {
	for (let i = branchEntries.length - 1; i >= 0; i--) {
		const entry = branchEntries[i];
		if (entry?.type !== "compaction") continue;
		const compaction = (entry.details as { serverCompaction?: ServerCompaction } | undefined)?.serverCompaction;
		if (!compaction) return undefined;
		return { compaction, summary: typeof entry.summary === "string" ? entry.summary : undefined };
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
 * A bounded local projection remains usable when an opaque item cannot be replayed.
 * It samples the whole compacted history, keeps recent messages verbatim where possible,
 * and preserves both ends of long individual messages.
 */
export function fallbackSummary(compactionId: string, messages: AgentMessage[], previousSummary?: string): string {
	const indices = projectionIndices(messages.length);
	const omittedCount = messages.length - indices.length;
	const header = `[Server-side compaction ${compactionId}]\n\nText fallback for ${messages.length} compacted messages.\n`;
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

export type ServerCompactionResult = { serverCompaction: ServerCompaction; summary: string };

async function resolveAuth(ctx: ExtensionContext, model: NonNullable<ExtensionContext["model"]>) {
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);
	return auth;
}

/** A ChatGPT subscription login on the `openai` provider; its key has no `sk-` prefix. */
async function isOpenAISubscriptionLogin(ctx: ExtensionContext, model: NonNullable<ExtensionContext["model"]>) {
	if (model.provider !== "openai") return false;
	const { apiKey } = await resolveAuth(ctx, model);
	return apiKey !== undefined && !apiKey.startsWith("sk-");
}

function notify(ctx: ExtensionContext, message: string): void {
	ctx.ui?.notify?.(message, "warning");
}

/**
 * Compact on the provider's server when the model supports it. Otherwise, or when
 * the server fails (the user is told why), returns undefined so Pi's summarizer runs.
 */
export async function compactOnServer(
	event: SessionBeforeCompactEvent,
	ctx: ExtensionContext,
	tools: Tool[],
): Promise<ServerCompactionResult | undefined> {
	const model = ctx.model;
	const method = serverCompactionMethod(model);
	if (!model || !method) return undefined;

	const branch = (event.branchEntries ?? []) as BranchEntry[];
	const latest = findLatestServerCompaction(branch)?.compaction;
	const previous = latest && compactionMatchesModel(latest, model) ? latest : undefined;
	const previousSummary = event.preparation.previousSummary ?? findLatestCompactionSummary(branch);
	const messages = [
		...(event.preparation.messagesToSummarize ?? []),
		...(event.preparation.turnPrefixMessages ?? []),
	] as AgentMessage[];
	const complete: ExtensionContext["modelRegistry"]["complete"] = (requestModel, context, options) =>
		ctx.modelRegistry.complete(requestModel, context, options);

	try {
		if (method === "anthropic") {
			const block = await compactWithAnthropic({
				complete,
				model,
				systemPrompt: ctx.getSystemPrompt(),
				tools,
				messages,
				previousBlock: previous?.api === "anthropic-messages" ? previous.block : undefined,
				previousSummary,
				maxTokens: Math.min(Math.floor(0.8 * event.preparation.settings.reserveTokens), model.maxTokens),
				signal: event.signal,
			});
			return {
				serverCompaction: { api: "anthropic-messages", provider: model.provider, block },
				summary: block.content,
			};
		}

		const previousItems = previous?.api === "anthropic-messages" ? undefined : previous?.items;
		const leadingSummary: AgentMessage[] =
			!previousItems && previousSummary
				? [{ role: "user", content: previousSummary, timestamp: 0 } as AgentMessage]
				: [];
		const items =
			method === "trigger"
				? await compactInRequest({
						complete,
						subscriptionLogin: await isOpenAISubscriptionLogin(ctx, model),
						model,
						systemPrompt: ctx.getSystemPrompt(),
						tools,
						messages: [...leadingSummary, ...messages],
						previousItems,
						signal: event.signal,
					})
				: await compactWithResponses({
						model,
						auth: await resolveAuth(ctx, model),
						messages: [...leadingSummary, ...messages],
						previousItems,
						signal: event.signal,
					});
		const marker = items.find((item) => item.type === "compaction");
		return {
			serverCompaction: {
				api: model.api as "openai-responses" | "openai-codex-responses",
				provider: model.provider,
				items,
			},
			summary: fallbackSummary(String(marker?.id ?? model.provider), messages, previousSummary),
		};
	} catch (err) {
		if (!event.signal?.aborted) {
			const reason = err instanceof Error ? err.message : String(err);
			notify(ctx, `Server-side compaction failed for ${model.provider} (${reason}); using Pi's summarizer.`);
		}
		return undefined;
	}
}

/** Replay the newest server result and disable replay only after an attributable 4xx. No compact hook. */
export function registerServerCompactionReplayHooks(pi: ExtensionAPI): void {
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
				`Server-side compaction result rejected by the provider (HTTP ${event.status}); using the text summary for the rest of this session. This turn still fails.`,
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

		if (compactionDisabledForSession) return undefined;
		const latest = findLatestServerCompaction((ctx.sessionManager?.getBranch?.() ?? []) as BranchEntry[]);
		if (!latest || !compactionMatchesModel(latest.compaction, ctx.model)) return undefined;

		const modified =
			latest.compaction.api === "anthropic-messages"
				? injectAnthropicCompaction(event.payload, latest.compaction, latest.summary)
				: injectResponsesCompaction(event.payload, latest.compaction, latest.summary);
		// A result already in the payload is not evidence that this extension injected it.
		if (wasOnlyOutstandingRequest && modified !== undefined) soleOutstandingRequestWasInjected = true;
		else soleOutstandingRequestWasInjected = false;
		return modified;
	});
}

export function activeTools(pi: ExtensionAPI): Tool[] {
	const active = new Set(pi.getActiveTools());
	return pi
		.getAllTools()
		.filter((tool) => active.has(tool.name))
		.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
}

export function registerServerCompactionHooks(pi: ExtensionAPI): void {
	registerServerCompactionReplayHooks(pi);
	pi.on("session_before_compact", async (event, ctx) => {
		const result = await compactOnServer(event, ctx, activeTools(pi));
		if (!result) return undefined;
		return {
			compaction: {
				summary: result.summary,
				firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore,
				details: {
					serverCompaction: { ...result.serverCompaction, replacesSummary: true },
					tokensBefore: event.preparation.tokensBefore,
				},
			},
		};
	});
}
