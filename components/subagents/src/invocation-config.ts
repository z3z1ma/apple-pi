import type { AgentConfig, JoinMode } from "./types.js";

interface AgentInvocationParams {
	run_in_background?: boolean;
	isolated?: boolean;
	inherit_context?: boolean;
	pair?: boolean;
	system_prompt?: string;
}

/** An explicit invocation value overrides the agent definition default. */
export function resolveAgentPair(agentConfig: AgentConfig | undefined, requestedPair: boolean | undefined): boolean {
	return requestedPair ?? agentConfig?.pair ?? agentConfig?.name.toLowerCase() === "builder";
}

export function resolveAgentInvocationConfig(
	agentConfig: AgentConfig | undefined,
	params: AgentInvocationParams,
): {
	maxTurns?: number;
	/** Invocation-level guidance appended after the selected definition. */
	systemPrompt?: string;
	inheritContext: boolean;
	pair: boolean;
	runInBackground: boolean;
	isolated: boolean;
} {
	return {
		// Turn ceilings are agent-definition or trusted-settings policy, never model arithmetic.
		maxTurns: agentConfig?.maxTurns,
		systemPrompt: params.system_prompt?.trim() || undefined,
		inheritContext: params.inherit_context === true,
		pair: resolveAgentPair(agentConfig, params.pair),
		runInBackground: params.run_in_background === true,
		isolated: params.isolated === true,
	};
}

export function resolveJoinMode(defaultJoinMode: JoinMode, runInBackground: boolean): JoinMode | undefined {
	return runInBackground ? defaultJoinMode : undefined;
}
