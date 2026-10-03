import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, Context, Model, Tool } from "@earendil-works/pi-ai";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import type { AnthropicCompactionBlock, ServerCompaction } from "./types.js";

type AnthropicCompaction = Extract<ServerCompaction, { api: "anthropic-messages" }>;

export const ANTHROPIC_COMPACTION_BETA = "compact-2026-09-04";

type CompleteFn = (
	model: Model<any>,
	context: Context,
	options: {
		maxTokens?: number;
		signal?: AbortSignal;
		onPayload?: (payload: unknown) => unknown;
		onProviderStreamEvent?: (event: unknown) => void;
	},
) => Promise<AssistantMessage>;

function withBeta(betas: unknown): string[] {
	const list = Array.isArray(betas) ? betas.filter((beta): beta is string => typeof beta === "string") : [];
	return list.includes(ANTHROPIC_COMPACTION_BETA) ? list : [...list, ANTHROPIC_COMPACTION_BETA];
}

function isCompactionBlock(value: unknown): value is AnthropicCompactionBlock {
	const block = value as Partial<AnthropicCompactionBlock> | null;
	return block?.type === "compaction" && typeof block.content === "string" && typeof block.signature === "string";
}

/** Turn an ordinary Messages request into a summarize request, as the compaction API requires. */
export function toCompactionRequest(payload: unknown, previousBlock?: AnthropicCompactionBlock): unknown {
	const request = { ...(payload as Record<string, unknown>) };
	request.compaction = { type: "summarize" };
	request.betas = withBeta(request.betas);
	delete request.stop_sequences;
	delete request.context_management;
	const toolChoice = (request.tool_choice as { type?: unknown } | undefined)?.type;
	if (toolChoice === "any" || toolChoice === "tool") delete request.tool_choice;
	const outputConfig = request.output_config as Record<string, unknown> | undefined;
	if (outputConfig && "format" in outputConfig) {
		const { format: _format, ...rest } = outputConfig;
		request.output_config = rest;
	}
	if (previousBlock && Array.isArray(request.messages)) {
		request.messages = [{ role: "assistant", content: [previousBlock] }, ...request.messages];
	}
	return request;
}

/**
 * Ask Claude to summarize on the server. Pi's Anthropic adapter builds the request,
 * so authentication, system prompt, and tools match ordinary turns. The block arrives
 * whole in one `content_block_start` event. Throws with the reason when none arrives.
 */
export async function compactWithAnthropic(options: {
	complete: CompleteFn;
	model: Model<any>;
	systemPrompt: string;
	tools: Tool[];
	messages: AgentMessage[];
	previousBlock?: AnthropicCompactionBlock;
	previousSummary?: string;
	maxTokens: number;
	signal?: AbortSignal;
}): Promise<AnthropicCompactionBlock> {
	const leadingSummary: AgentMessage[] =
		!options.previousBlock && options.previousSummary
			? [{ role: "user", content: options.previousSummary, timestamp: 0 } as AgentMessage]
			: [];
	let block: AnthropicCompactionBlock | undefined;
	const result = await options.complete(
		options.model,
		{
			systemPrompt: options.systemPrompt,
			messages: convertToLlm([...leadingSummary, ...options.messages]),
			tools: options.tools,
		},
		{
			maxTokens: options.maxTokens,
			signal: options.signal,
			onPayload: (payload) => toCompactionRequest(payload, options.previousBlock),
			onProviderStreamEvent: (event) => {
				const candidate = (event as { type?: unknown; content_block?: unknown } | null)?.content_block;
				if ((event as { type?: unknown }).type === "content_block_start" && isCompactionBlock(candidate)) {
					block = candidate;
				}
			},
		},
	);
	if (block) return block;
	throw new Error(result.errorMessage ?? `no compaction block (stop reason ${result.stopReason})`);
}

function messageText(message: unknown): string {
	const content = (message as { content?: unknown } | null)?.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => (typeof part?.text === "string" ? part.text : "")).join("");
}

/**
 * Send the signed block first, as an assistant message, with the compaction beta.
 * When the entry's text summary is the block's own text, leave that message out.
 */
export function injectAnthropicCompaction(
	payload: unknown,
	compaction: AnthropicCompaction,
	summary: string | undefined,
): unknown {
	if (payload === null || typeof payload !== "object") return undefined;
	const record = payload as Record<string, unknown>;
	if (!Array.isArray(record.messages)) return undefined;
	const signature = compaction.block.signature;
	const alreadyPresent = record.messages.some(
		(message) =>
			Array.isArray(message?.content) &&
			message.content.some((part: unknown) => isCompactionBlock(part) && part.signature === signature),
	);
	if (alreadyPresent) return undefined;

	const messages = record.messages.filter(
		(message) =>
			!(compaction.replacesSummary && summary && message?.role === "user" && messageText(message).includes(summary)),
	);
	return {
		...record,
		betas: withBeta(record.betas),
		messages: [{ role: "assistant", content: [compaction.block] }, ...messages],
	};
}
