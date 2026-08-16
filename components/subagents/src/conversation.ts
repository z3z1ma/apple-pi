import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { extractText } from "./context.js";

/** Hard cap for a model-facing recent-transcript check-in. */
export const TRANSCRIPT_TAIL_MAX_CHARS = 12_000;

function isConversationMessage(message: { role: string }): boolean {
	return message.role === "user" || message.role === "assistant" || message.role === "toolResult";
}

/**
 * Format all, or only the most recent N, displayable child-session messages.
 * A tail includes the currently streaming assistant message and is character-
 * bounded so one large message cannot consume the orchestrator's context.
 */
export function getAgentConversation(session: AgentSession, tailMessages?: number): string {
	const parts: string[] = [];
	const transcript = session.messages.filter(isConversationMessage);
	const streaming = session.state?.streamingMessage;
	if (streaming && isConversationMessage(streaming) && transcript.at(-1) !== streaming) transcript.push(streaming);
	const messages = tailMessages === undefined ? transcript : transcript.slice(-Math.max(1, Math.floor(tailMessages)));

	for (const msg of messages) {
		if (msg.role === "user") {
			const text = typeof msg.content === "string" ? msg.content : extractText(msg.content);
			if (text.trim()) parts.push(`[User]: ${text.trim()}`);
		} else if (msg.role === "assistant") {
			const textParts: string[] = [];
			const toolCalls: string[] = [];
			for (const c of msg.content) {
				if (c.type === "text" && c.text) textParts.push(c.text);
				else if (c.type === "toolCall")
					toolCalls.push(`  Tool: ${(c as any).name ?? (c as any).toolName ?? "unknown"}`);
			}
			if (textParts.length > 0) parts.push(`[Assistant]: ${textParts.join("\n")}`);
			if (toolCalls.length > 0) parts.push(`[Tool Calls]:\n${toolCalls.join("\n")}`);
		} else if (msg.role === "toolResult") {
			const text = extractText(msg.content);
			const truncated = text.length > 200 ? `${text.slice(0, 200)}...` : text;
			parts.push(`[Tool Result (${msg.toolName})]: ${truncated}`);
		}
	}

	const rendered = parts.join("\n\n");
	if (tailMessages === undefined || rendered.length <= TRANSCRIPT_TAIL_MAX_CHARS) return rendered;

	const marker = `[Earlier transcript content clipped; showing up to ${TRANSCRIPT_TAIL_MAX_CHARS.toLocaleString()} recent characters]\n\n`;
	const budget = TRANSCRIPT_TAIL_MAX_CHARS - marker.length;
	const latest = parts.at(-1) ?? "";
	if (latest.length > budget) {
		const prefix = latest.match(/^\[[^\]]+\]:(?: |\n)/)?.[0] ?? "[Message]: ";
		const suffixBudget = Math.max(0, budget - prefix.length - 1);
		const suffix = suffixBudget === 0 ? "" : latest.slice(-suffixBudget);
		return `${marker}${prefix}…${suffix}`;
	}

	const kept: string[] = [];
	let used = 0;
	for (let index = parts.length - 1; index >= 0; index--) {
		const separatorLength = kept.length === 0 ? 0 : 2;
		if (used + separatorLength + parts[index].length > budget) break;
		kept.unshift(parts[index]);
		used += separatorLength + parts[index].length;
	}
	return marker + kept.join("\n\n");
}
