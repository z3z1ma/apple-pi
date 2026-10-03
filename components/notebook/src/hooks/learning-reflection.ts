import type { ExtensionAPI, SessionBoundaryDraft, ToolResultEvent } from "@earendil-works/pi-coding-agent";

export const LEARNING_REFLECTION_MESSAGE_TYPE = "notebook.learning-reflection";

/** New tokens between run-end reflections; chosen by the user, to be tuned from real use. */
export const LEARNING_REFLECTION_SPACING_TOKENS = 500_000;

const REFLECTION =
	"Reflect on what you learned since the last reflection. What surprised you? Which failures taught something, and what worked instead? Did you find how to reach an environment or service, a harness pitfall, or a user correction worth keeping? Record each learning with `update_notebook`, and skip ordinary failures that taught nothing.\n\n" +
	"Then propose, in your reply, where each open learning in the notebook belongs: a wiki page, the governing task's retrospective, `AGENTS.md`, a skill, a saved program in `.pi/programs/`, or a test or doc. Write it there only after the user approves, then retire it. If nothing is worth keeping, say so in one line and finish.";

export function learningReflectionPrompt(evidence: readonly string[]): string {
	if (evidence.length === 0) return REFLECTION;
	return `${REFLECTION}\n\nFailed or surprising tool calls since the last reflection:\n${evidence.map((item) => `- ${item}`).join("\n")}`;
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
 * Ask the main agent to reflect at run end once enough new tokens have passed,
 * with the failed or surprising tool calls of that stretch as evidence; `/reflect` asks on demand.
 */
export function registerLearningReflection(pi: ExtensionAPI): void {
	let newTokens = 0;
	let evidence: string[] = [];

	const reset = () => {
		newTokens = 0;
		evidence = [];
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

	pi.on("tool_result", (event) => {
		const item = describeEvidence(event);
		if (item && !evidence.includes(item)) evidence.push(item);
	});

	pi.on("agent_before_settle", (event) => {
		if (event.outcome !== "completed" || newTokens < LEARNING_REFLECTION_SPACING_TOKENS) return;
		const entry: SessionBoundaryDraft = {
			type: "custom_message",
			customType: LEARNING_REFLECTION_MESSAGE_TYPE,
			content: takePrompt(),
			display: true,
		};
		return { entries: [entry], continue: true };
	});

	pi.registerCommand("reflect", {
		description: "Ask the agent to record what it learned and propose where each learning belongs",
		handler: async () => {
			pi.sendMessage(
				{ customType: LEARNING_REFLECTION_MESSAGE_TYPE, content: takePrompt(), display: true },
				{ deliverAs: "steer", triggerTurn: true },
			);
		},
	});
}
