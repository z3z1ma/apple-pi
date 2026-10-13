import type { ExtensionAPI, ToolResultEvent } from "@earendil-works/pi-coding-agent";

import { inForkedContinuation } from "../../../shared/src/fork-context.js";
import { registerForkedContinuation } from "../../../shared/src/forked-continuation.js";
import { distillPrompt } from "../distillation.js";
import { openLearnings } from "./open-learnings.js";

export const LEARNING_REFLECTION_MESSAGE_TYPE = "notebook.learning-reflection";
export const LEARNING_DISTILLATION_MESSAGE_TYPE = "notebook.learning-distillation";

/** New tokens between automatic reflections; chosen by the user, to be tuned from real use. */
export const LEARNING_REFLECTION_SPACING_TOKENS = 500_000;

const QUESTIONS =
	"Reflect on what you learned since the last reflection. What surprised you? Which failures taught something, and what worked instead? Did you find how to reach an environment or service, a harness pitfall, or a user correction worth keeping? Record each learning with `update_notebook`, and skip ordinary failures that taught nothing.";

function withEvidence(prompt: string, evidence: readonly string[]): string {
	if (evidence.length === 0) return prompt;
	return `${prompt}\n\nFailed or surprising tool calls since the last reflection:\n${evidence.map((item) => `- ${item}`).join("\n")}`;
}

export function learningReflectionPrompt(evidence: readonly string[]): string {
	return withEvidence(`${QUESTIONS} If nothing is worth keeping, say so in one line.`, evidence);
}

/** The learning questions and evidence, for a caller that supplies its own closing instruction. */
export function learningQuestions(evidence: readonly string[]): string {
	return withEvidence(QUESTIONS, evidence);
}

function describeCall(toolName: string, input: Record<string, unknown>): string {
	const target = [input.command, input.path, input.pattern].find((value) => typeof value === "string");
	return typeof target === "string" ? `${toolName}: \`${target.split("\n")[0]}\`` : toolName;
}

/** A failure the agent predicted teaches nothing; a success the bash tool marks as a surprise does. */
function describeEvidence(event: ToolResultEvent): string | undefined {
	if (event.isError) return event.input.expect === "failure" ? undefined : describeCall(event.toolName, event.input);
	const details = event.details as { surprise?: unknown } | undefined;
	return details?.surprise === true
		? `${describeCall(event.toolName, event.input)} succeeded; you predicted failure`
		: undefined;
}

/**
 * Failed or surprising tool calls, deduplicated in first-seen order. Tool calls made inside a
 * forked continuation are not the agent's own. The caller empties it when it reflects.
 */
export function trackLearningEvidence(pi: ExtensionAPI): string[] {
	const evidence: string[] = [];
	pi.on("tool_result", (event, ctx) => {
		if (inForkedContinuation(ctx.sessionManager.getSessionId())) return;
		const item = describeEvidence(event);
		if (item && !evidence.includes(item)) evidence.push(item);
	});
	return evidence;
}

/** Reflection and distillation forks run one at a time, so a distill sees what a reflection captured. */
function forkLane(pi: ExtensionAPI): (start: () => Promise<void>) => void {
	let lane = Promise.resolve();
	let generation = 0;
	const invalidate = () => {
		generation++;
	};
	pi.on("session_start", invalidate);
	pi.on("session_tree", invalidate);
	pi.on("session_shutdown", invalidate);
	return (start) => {
		const queuedIn = generation;
		lane = lane.then(() => (queuedIn === generation ? start() : undefined));
	};
}

/**
 * Capture: once enough new tokens have passed, reflect in a headless fork after a
 * completed run, with the failed or surprising tool calls of that stretch as evidence.
 * Distill: right after each compaction, while the context has room, a headless fork
 * moves durable open learnings to project files and retires stale ones.
 * `/reflect` and `/distill` ask the main agent in-band at any time.
 */
export function registerLearningCycle(pi: ExtensionAPI): void {
	const reflect = registerForkedContinuation(pi, LEARNING_REFLECTION_MESSAGE_TYPE, "Reflection");
	const distill = registerForkedContinuation(pi, LEARNING_DISTILLATION_MESSAGE_TYPE, "Distill");
	const enqueue = forkLane(pi);
	let newTokens = 0;
	let completed = false;
	const evidence = trackLearningEvidence(pi);

	const reset = () => {
		newTokens = 0;
		evidence.length = 0;
	};
	const takePrompt = () => {
		const prompt = learningReflectionPrompt(evidence);
		reset();
		return prompt;
	};

	pi.on("session_start", reset);

	pi.on("message_end", (event) => {
		const message = event.message;
		if (message.role !== "assistant") return;
		newTokens += message.usage.input + message.usage.cacheWrite + message.usage.output;
	});

	pi.on("agent_before_settle", (event) => {
		completed = event.outcome === "completed";
	});

	pi.on("agent_settled", (_event, ctx) => {
		if (!completed || newTokens < LEARNING_REFLECTION_SPACING_TOKENS) return;
		const prompt = takePrompt();
		enqueue(() => reflect(ctx, prompt));
	});

	pi.on("session_compact", (_event, ctx) => {
		enqueue(() => {
			const learnings = openLearnings(ctx);
			if (learnings.length === 0) return Promise.resolve();
			return distill(ctx, distillPrompt(learnings));
		});
	});

	pi.registerCommand("reflect", {
		description: "Ask the agent to record what it learned in the notebook",
		handler: async () => {
			pi.sendMessage(
				{ customType: LEARNING_REFLECTION_MESSAGE_TYPE, content: takePrompt(), display: true },
				{ deliverAs: "steer", triggerTurn: true },
			);
		},
	});

	pi.registerCommand("distill", {
		description: "Ask the agent to move durable learnings from the notebook to project files",
		handler: async (_args, ctx) => {
			const learnings = openLearnings(ctx);
			if (learnings.length === 0) {
				ctx.ui.notify("No open learnings to distill.", "info");
				return;
			}
			pi.sendMessage(
				{ customType: LEARNING_DISTILLATION_MESSAGE_TYPE, content: distillPrompt(learnings), display: true },
				{ deliverAs: "steer", triggerTurn: true },
			);
		},
	});
}
