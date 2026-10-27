import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Context, Model, Tool } from "@earendil-works/pi-ai";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import { convertMessagesForResponsesCompaction } from "./convert.js";
import type { ResponsesCompactionItem, ServerCompaction } from "./types.js";

type ResponsesCompaction = Exclude<ServerCompaction, { api: "anthropic-messages" }>;

export type ResponsesAuth = {
	apiKey?: string;
	headers?: Record<string, string | null>;
	baseUrl?: string;
};

function compactEndpoint(model: Model<any>, auth: ResponsesAuth): string {
	const baseUrl = (auth.baseUrl || model.baseUrl).replace(/\/+$/, "");
	return `${baseUrl}/responses/compact`;
}

function requestHeaders(auth: ResponsesAuth): Record<string, string> {
	const headers: Record<string, string> = { "Content-Type": "application/json" };
	for (const [key, value] of Object.entries(auth.headers ?? {})) {
		if (typeof value === "string") headers[key] = value;
	}
	if (auth.apiKey) headers.Authorization = `Bearer ${auth.apiKey}`;
	return headers;
}

/** Keep every output item; OpenAI may return retained items next to the compaction item. */
export function parseCompactionOutput(data: unknown): ResponsesCompactionItem[] | undefined {
	const output = (data as { output?: unknown } | null)?.output;
	if (!Array.isArray(output)) return undefined;
	const items = output.filter(
		(item): item is ResponsesCompactionItem =>
			typeof item === "object" && item !== null && typeof (item as { type?: unknown }).type === "string",
	);
	const compaction = items.find((item) => item.type === "compaction");
	return typeof compaction?.encrypted_content === "string" ? items : undefined;
}

/** Throws with the provider's reason when compaction fails, so the caller can report it. */
export async function compactWithResponses(options: {
	model: Model<any>;
	auth: ResponsesAuth;
	messages: AgentMessage[];
	previousItems?: ResponsesCompactionItem[];
	signal?: AbortSignal;
}): Promise<ResponsesCompactionItem[]> {
	const input = convertMessagesForResponsesCompaction(options.messages, options.model, options.previousItems);
	const response = await fetch(compactEndpoint(options.model, options.auth), {
		method: "POST",
		headers: requestHeaders(options.auth),
		body: JSON.stringify({ model: options.model.id, input }),
		signal: options.signal,
	});
	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
	}
	const items = parseCompactionOutput(await response.json());
	if (!items) throw new Error("the response had no compaction item");
	return items;
}

type CompleteFn = (
	model: Model<any>,
	context: Context,
	options: {
		maxTokens?: number;
		signal?: AbortSignal;
		transport?: "sse";
		onPayload?: (payload: unknown) => unknown;
		onProviderStreamEvent?: (event: unknown) => void;
	},
) => Promise<AssistantMessage>;

/** OpenAI's minimum trigger threshold; generation stops once it emits a checkpoint. */
const SUBSCRIPTION_COMPACT_THRESHOLD = 1000;

/**
 * Compact in an ordinary Responses request with the session's instructions and tools.
 * As Codex does, a `compaction_trigger` item last makes the server answer with one
 * compaction item. ChatGPT subscription logins refuse the trigger but accept
 * `context_management`, which can compact repeatedly while generating a reply.
 * Stop that generation at the first complete checkpoint. SSE exposes its raw item.
 */
export async function compactInRequest(options: {
	complete: CompleteFn;
	subscriptionLogin: boolean;
	model: Model<any>;
	systemPrompt: string;
	tools: Tool[];
	messages: AgentMessage[];
	previousItems?: ResponsesCompactionItem[];
	signal?: AbortSignal;
}): Promise<ResponsesCompactionItem[]> {
	options.signal?.throwIfAborted();
	const completionController = new AbortController();
	const signal = options.signal
		? AbortSignal.any([options.signal, completionController.signal])
		: completionController.signal;
	let compaction: ResponsesCompactionItem | undefined;
	let result: AssistantMessage | undefined;
	try {
		result = await options.complete(
			options.model,
			{ systemPrompt: options.systemPrompt, messages: convertToLlm(options.messages), tools: options.tools },
			{
				signal,
				transport: "sse",
				onPayload: (payload) => {
					const record = payload as Record<string, unknown>;
					const input = withCompactionFirst(
						Array.isArray(record.input) ? record.input : [],
						options.previousItems ?? [],
					);
					if (options.subscriptionLogin) {
						return {
							...record,
							input,
							context_management: [{ type: "compaction", compact_threshold: SUBSCRIPTION_COMPACT_THRESHOLD }],
						};
					}
					input.push({ type: "compaction_trigger" });
					return { ...record, input };
				},
				onProviderStreamEvent: (event) => {
					const record = event as { type?: unknown; item?: ResponsesCompactionItem } | null;
					if (
						record?.type === "response.output_item.done" &&
						record.item?.type === "compaction" &&
						typeof record.item.encrypted_content === "string"
					) {
						if (options.subscriptionLogin && compaction) return;
						compaction = record.item;
						if (options.subscriptionLogin) completionController.abort();
					}
				},
			},
		);
	} catch (error) {
		if (!compaction || !completionController.signal.aborted || options.signal?.aborted) throw error;
	}
	options.signal?.throwIfAborted();
	if (compaction) return [compaction];
	throw new Error(result?.errorMessage ?? `no compaction item (stop reason ${result?.stopReason})`);
}

/** The server drops input that precedes a compaction item, so instructions and tool declarations go after it. */
function withCompactionFirst(input: unknown[], items: ResponsesCompactionItem[]): unknown[] {
	return [...items, ...input];
}

function itemKey(item: ResponsesCompactionItem): unknown {
	return item.id ?? item.encrypted_content;
}

function inputText(item: unknown): string {
	const content = (item as { content?: unknown } | null)?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
}

/**
 * Put the compaction items first. When the entry's text summary only copies the
 * server result, leave that message out.
 */
export function injectResponsesCompaction(
	payload: unknown,
	compaction: ResponsesCompaction,
	summary: string | undefined,
): unknown {
	if (payload === null || typeof payload !== "object") return undefined;
	const record = payload as Record<string, unknown>;
	if (!Array.isArray(record.input)) return undefined;
	const marker = compaction.items.find((item) => item.type === "compaction");
	if (!marker) return undefined;
	const key = itemKey(marker);
	if (record.input.some((item) => (item as { type?: unknown })?.type === "compaction" && itemKey(item) === key)) {
		return undefined;
	}

	const input = (record.input as Record<string, unknown>[]).filter(
		(item) => !(compaction.replacesSummary && summary && item.role === "user" && inputText(item).includes(summary)),
	);
	return { ...record, input: withCompactionFirst(input, compaction.items) };
}
