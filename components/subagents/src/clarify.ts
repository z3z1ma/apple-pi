import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolCall, Usage } from "@earendil-works/pi-ai";
import {
	type AgentSession,
	buildSessionContext,
	defineTool,
	type ExtensionAPI,
	type ExtensionContext,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type AgentRunContext, runAgent } from "./agent-runner.js";
import { disposeAgentSession } from "./session-lifecycle.js";
import type { AgentConfig } from "./types.js";

const CLARIFICATION_CONFIG: AgentConfig = {
	name: "parent-clarification",
	description: "Read-only clarification from a parent snapshot",
	builtinToolNames: ["read", "grep", "find", "ls"],
	extensions: false,
	skills: false,
	pair: false,
	persistSession: false,
	promptMode: "append",
	systemPrompt: `You are an ephemeral read-only fork of the agent that delegated work to the questioner.
Your conversation is a snapshot of that parent's active branch at question time. Answer only the child's clarification question, using the existing user intent, decisions, and constraints. Inspect repository files with your read-only tools when needed.
Distinguish settled decisions from your own recommendations and uncertainty. Requests that need new user authorization remain unresolved and should be raised with the live parent. Your answer is advice to the child, not a new user instruction or approval.
The parent continues independently. Its unfinished tool calls have snapshot placeholders rather than results. Repository reads see current files, which may have changed since the snapshot.
Return a direct, self-contained answer to the child. Your available capabilities are read-only repository tools; execution, delegation, parent messaging, and further clarification belong to the live sessions.`,
};

/** Materialize the portable, compaction-aware conversation without sharing mutable parent state. */
export function captureClarifyContext(parent: AgentRunContext): AgentRunContext & { sessionManager: SessionManager } {
	const cwd = parent.cwd;
	const model = parent.model;
	if (!model) throw new Error("Cannot clarify without an active parent model.");
	const modelRegistry = parent.modelRegistry;
	const thinkingLevel = parent.thinkingLevel;
	const systemPrompt = parent.getSystemPrompt();
	const projectTrusted = parent.isProjectTrusted?.() ?? false;
	const messages = structuredClone(buildSessionContext(parent.sessionManager.getBranch()).messages);
	const sessionManager = SessionManager.inMemory(cwd);
	const pending = new Map<string, ToolCall>();
	const flushPending = () => {
		for (const call of pending.values()) {
			sessionManager.appendMessage({
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
		pending.clear();
	};
	for (const message of messages) {
		if (message.role !== "toolResult") flushPending();
		if (message.role === "assistant") {
			if (message.stopReason === "pending") continue;
			for (const block of message.content) if (block.type === "toolCall") pending.set(block.id, block);
		} else if (message.role === "toolResult") pending.delete(message.toolCallId);
		appendSnapshotMessage(sessionManager, message);
	}
	flushPending();
	return {
		cwd,
		model,
		modelRegistry,
		thinkingLevel,
		sessionManager,
		getSystemPrompt: () => systemPrompt,
		isProjectTrusted: () => projectTrusted,
	};
}

function appendSnapshotMessage(session: SessionManager, message: AgentMessage): void {
	if (message.role === "compactionSummary") {
		session.appendCompaction(message.summary, "", message.tokensBefore);
	} else if (message.role === "branchSummary") {
		session.branchWithSummary(session.getLeafId(), message.summary);
	} else {
		session.appendMessage(message);
	}
}

export function createClarifyTool(pi: ExtensionAPI, parent: ExtensionContext) {
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
			const snapshot = captureClarifyContext(parent);
			let session: AgentSession | undefined;
			let unsubscribe: (() => void) | undefined;
			const usage: Usage = {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			};
			try {
				const result = await runAgent(
					snapshot,
					CLARIFICATION_CONFIG.name,
					`Clarification question from your child agent:\n\n${question}`,
					{
						pi,
						agentConfig: CLARIFICATION_CONFIG,
						sessionManager: snapshot.sessionManager,
						model: snapshot.model,
						modelResolved: true,
						thinkingLevel: snapshot.thinkingLevel,
						loadStandardChildExtensions: false,
						signal,
						onSessionCreated: (created) => {
							session = created;
							unsubscribe = created.subscribe((event) => {
								if (event.type !== "message_end" || event.message.role !== "assistant") return;
								const delta = event.message.usage;
								usage.input += delta.input;
								usage.output += delta.output;
								usage.cacheRead += delta.cacheRead;
								usage.cacheWrite += delta.cacheWrite;
								usage.totalTokens += delta.totalTokens;
								for (const key of Object.keys(usage.cost) as Array<keyof Usage["cost"]>)
									usage.cost[key] += delta.cost[key];
							});
						},
					},
				);
				signal?.throwIfAborted();
				if (result.aborted) throw new Error("Clarification was aborted.");
				if (result.failure) throw new Error(`Clarification failed: ${result.failure}`);
				return {
					content: [{ type: "text" as const, text: result.responseText }],
					details: { provider: snapshot.model!.provider, model: snapshot.model!.id },
					usage,
				};
			} finally {
				unsubscribe?.();
				await disposeAgentSession(session);
			}
		},
	});
}
