import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { abortable } from "../../shared/src/abortable.js";
import { liveSession, startFork } from "../../shared/src/forked-continuation.js";

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);
const CLARIFICATION_FRAME = `You are an ephemeral read-only fork of the agent that delegated work to the questioner.
Answer only the child's clarification question, using the existing user intent, decisions, and constraints. Inspect repository files with read, grep, find, or ls when needed. All other tools are blocked in this fork.
Distinguish settled decisions from your own recommendations and uncertainty. Requests that need new user authorization remain unresolved and should be raised with the live parent. Your answer is advice to the child, not a new user instruction or approval.
The parent continues independently. Its unfinished tool calls have snapshot placeholders rather than results. Repository reads see current files, which may have changed since the snapshot.
Return a direct, self-contained answer to the child. Your messages stay in this fork and only your answer returns to the child.`;

/** Keep the parent's prefix intact and close only its still-unanswered calls at the end. */
function closePendingCalls(messages: AgentMessage[]): void {
	const pending = new Map<string, { id: string; name: string }>();
	for (const message of messages) {
		if (message.role === "assistant") {
			for (const block of message.content) if (block.type === "toolCall") pending.set(block.id, block);
		} else if (message.role === "toolResult") pending.delete(message.toolCallId);
	}
	for (const call of pending.values())
		messages.push({
			role: "toolResult",
			toolCallId: call.id,
			toolName: call.name,
			content: [
				{
					type: "text",
					text: "Parent tool result unavailable at clarification snapshot time. The fork has not executed this call.",
				},
			],
			isError: true,
			timestamp: Date.now(),
		});
}

export function createClarifyTool(parent: ExtensionContext) {
	return defineTool({
		name: "clarify",
		label: "Clarify",
		description:
			"Ask an independent, ephemeral read-only fork of your immediate parent about task intent, prior decisions, constraints, or missing context. Each call uses the parent's latest conversation and model without waiting for or interrupting it. Include relevant findings in your question: the fork sees the parent history, not your private conversation. Answers are advice, not new user authorization.",
		parameters: Type.Object({
			question: Type.String({
				minLength: 1,
				description: "The clarification question, including relevant child findings or alternatives.",
			}),
		}),
		async execute(_id, { question }, signal) {
			if (!question.trim()) throw new Error("Clarification question must not be blank.");
			signal?.throwIfAborted();
			const session = liveSession(parent);
			if (!session) throw new Error("Cannot clarify: the live parent session is not available.");
			const model = session.agent.state.model;
			const messages = structuredClone(session.sessionManager.buildSessionProjection().messages);
			closePendingCalls(messages);
			const fork = startFork(session, {
				messages,
				append: {
					role: "custom",
					customType: "parent-clarification",
					content: `${CLARIFICATION_FRAME}\n\nClarification question from your child agent:\n\n${question}`,
					display: false,
					timestamp: Date.now(),
				},
				label: "Parent clarification",
				recordUsage: false,
				blockedTools: new Set(
					session.agent.state.tools.filter((tool) => !READ_ONLY_TOOLS.has(tool.name)).map((tool) => tool.name),
				),
			});
			const abort = () => fork.abort();
			signal?.addEventListener("abort", abort, { once: true });
			try {
				const result = await abortable(fork.result, signal);
				signal?.throwIfAborted();
				const last = result.messages.at(-1);
				if (last?.role !== "assistant") throw new Error("Clarification finished without a reply.");
				if (last.stopReason === "aborted" || last.stopReason === "error")
					throw new Error(`Clarification failed: ${last.errorMessage ?? last.stopReason}`);
				const text = last.content
					.flatMap((block) => (block.type === "text" ? [block.text] : []))
					.join("\n")
					.trim();
				if (!text) throw new Error("Clarification finished without a reply.");
				const usage: Usage = {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				};
				for (const delta of result.usage) {
					usage.input += delta.input;
					usage.output += delta.output;
					usage.cacheRead += delta.cacheRead;
					usage.cacheWrite += delta.cacheWrite;
					usage.totalTokens += delta.totalTokens;
					for (const key of Object.keys(usage.cost) as Array<keyof Usage["cost"]>) usage.cost[key] += delta.cost[key];
				}
				return {
					content: [{ type: "text" as const, text }],
					details: { provider: model.provider, model: model.id },
					usage,
				};
			} finally {
				signal?.removeEventListener("abort", abort);
				if (signal?.aborted) fork.abort();
			}
		},
	});
}
