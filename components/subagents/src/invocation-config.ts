import type { AgentConfig, JoinMode } from "./types.js";

interface AgentInvocationParams {
	run_in_background?: boolean;
	isolated?: boolean;
	inherit_context?: boolean;
	sentinel?: boolean;
	system_prompt?: string;
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
	inheritContext: boolean;
	sentinel: boolean;
	runInBackground: boolean;
	isolated: boolean;
} {
	return {
		// Turn ceilings are agent-definition or trusted-settings policy, never model arithmetic.
		maxTurns: agentConfig?.maxTurns,
		systemPrompt: params.system_prompt?.trim() || undefined,
		inheritContext: params.inherit_context === true,
		sentinel: resolveAgentSentinel(agentConfig, params.sentinel),
		runInBackground: params.run_in_background === true,
		isolated: params.isolated === true,
	};
}

export function resolveJoinMode(defaultJoinMode: JoinMode, runInBackground: boolean): JoinMode | undefined {
	return runInBackground ? defaultJoinMode : undefined;
}
