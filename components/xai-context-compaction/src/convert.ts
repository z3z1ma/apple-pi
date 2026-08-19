import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import type { XaiCompactionItem } from "./types.js";

/** Check if a model is an xAI model running on the openai-responses API. */
export function isXaiResponsesModel(model: { provider?: unknown; api?: unknown } | null | undefined): boolean {
	return model?.provider === "xai" && model.api === "openai-responses";
}

function userContent(content: unknown): unknown {
	if (typeof content === "string") {
		return [{ type: "input_text", text: content }];
	}
	if (!Array.isArray(content)) return [{ type: "input_text", text: "" }];
	const parts: Array<Record<string, unknown>> = [];
	for (const part of content) {
		if (typeof part !== "object" || part === null) continue;
		const record = part as { type?: unknown; text?: unknown; mimeType?: unknown; data?: unknown };
		if (record.type === "text" && typeof record.text === "string") {
			parts.push({ type: "input_text", text: record.text });
			continue;
		}
		if (record.type === "image" && typeof record.mimeType === "string" && typeof record.data === "string") {
			parts.push({
				type: "input_image",
				detail: "auto",
				image_url: `data:${record.mimeType};base64,${record.data}`,
			});
		}
	}
	return parts.length > 0 ? parts : [{ type: "input_text", text: "" }];
}

function toolOutput(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((part) => typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text")
		.map((part) => (part as { text?: string }).text ?? "")
		.join("\n");
}

/**
 * Convert Pi messages into xAI Responses `input` items, keeping tool calls,
 * tool results, reasoning signatures, and images.
 */
export function convertMessagesForXaiCompaction(
	messages: AgentMessage[],
	previousCompactionItem?: XaiCompactionItem,
): Record<string, unknown>[] {
	const input: Record<string, unknown>[] = [];
	if (previousCompactionItem) {
		input.push({
			type: "compaction",
			id: previousCompactionItem.id,
			encrypted_content: previousCompactionItem.encrypted_content,
		});
	}

	for (const msg of convertToLlm(messages)) {
		if (msg.role === "user") {
			input.push({ role: "user", content: userContent(msg.content) });
			continue;
		}
		if (msg.role === "assistant") {
			const blocks = Array.isArray(msg.content) ? msg.content : [];
			for (const block of blocks) {
				if (block.type === "thinking" && "thinkingSignature" in block && typeof block.thinkingSignature === "string") {
					try {
						input.push(JSON.parse(block.thinkingSignature) as Record<string, unknown>);
					} catch {
						// Unsigned or non-Responses reasoning is omitted; text/tool blocks still convert.
					}
					continue;
				}
				if (block.type === "text") {
					input.push({
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: block.text, annotations: [] }],
						status: "completed",
					});
					continue;
				}
				if (block.type === "toolCall") {
					const [callId, itemId] = block.id.split("|");
					input.push({
						type: "function_call",
						id: itemId,
						call_id: callId,
						name: block.name,
						arguments: JSON.stringify(block.arguments ?? {}),
					});
				}
			}
			continue;
		}
		if (msg.role === "toolResult") {
			const [callId] = msg.toolCallId.split("|");
			input.push({
				type: "function_call_output",
				call_id: callId,
				output: toolOutput(msg.content),
			});
		}
	}

	return input;
}
