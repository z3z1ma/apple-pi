import type { AgentConfig, JoinMode } from "./types.js";

export type AgentContextMode = "handoff" | "inherit" | "consultation";

interface AgentInvocationParams {
	run_in_background?: boolean;
	isolated?: boolean;
	inherit_context?: boolean;
	context_mode?: AgentContextMode;
	sentinel?: boolean;
	system_prompt?: string;
}

export function resolveAgentContextMode(
	mode: AgentContextMode | undefined,
	inheritContext: boolean | undefined,
): { mode: AgentContextMode; error?: string } {
	if (!mode) return { mode: inheritContext === true ? "inherit" : "handoff" };
	if (inheritContext === true && mode !== "inherit") {
		return { mode, error: `context_mode ${JSON.stringify(mode)} contradicts inherit_context: true` };
	}
	return { mode };
}

/** An explicit invocation value overrides the agent definition default. */
export function resolveAgentSentinel(
	agentConfig: AgentConfig | undefined,
	requestedSentinel: boolean | undefined,
): boolean {
	return requestedSentinel ?? agentConfig?.sentinel ?? agentConfig?.name.toLowerCase() === "implement";
}

export function resolveAgentInvocationConfig(
	agentConfig: AgentConfig | undefined,
	params: AgentInvocationParams,
): {
	maxTurns?: number;
	/** Invocation-level guidance appended after the selected definition. */
	systemPrompt?: string;
	contextMode: AgentContextMode;
	/** true only for full parent text inheritance. */
	inheritContext: boolean;
	sentinel: boolean;
	runInBackground: boolean;
	isolated: boolean;
} {
	const context = resolveAgentContextMode(params.context_mode, params.inherit_context);
	return {
		// Turn ceilings are agent-definition or trusted-settings policy, never model arithmetic.
		maxTurns: agentConfig?.maxTurns,
		systemPrompt: params.system_prompt?.trim() || undefined,
		contextMode: context.mode,
		inheritContext: context.mode === "inherit",
		sentinel: resolveAgentSentinel(agentConfig, params.sentinel),
		runInBackground: params.run_in_background === true,
		isolated: params.isolated === true,
	};
}

export function resolveJoinMode(defaultJoinMode: JoinMode, runInBackground: boolean): JoinMode | undefined {
	return runInBackground ? defaultJoinMode : undefined;
}
