import type { AgentConfig, JoinMode, ThinkingLevel } from "./types.js";

interface AgentInvocationParams {
	thinking?: string;
	run_in_background?: boolean;
	isolated?: boolean;
	inherit_context?: boolean;
	advisor?: boolean;
}

export function resolveAgentInvocationConfig(
	agentConfig: AgentConfig | undefined,
	params: AgentInvocationParams,
): {
	thinking?: ThinkingLevel;
	maxTurns?: number;
	/** undefined = compact handoff, true = full parent branch, false = none. */
	inheritContext: boolean;
	advisor: boolean;
	runInBackground: boolean;
	isolated: boolean;
} {
	return {
		thinking: (params.thinking ?? agentConfig?.thinking) as ThinkingLevel | undefined,
		// Turn ceilings are agent-definition or trusted-settings policy, never model arithmetic.
		maxTurns: agentConfig?.maxTurns,
		// These execution choices belong to each invocation. Explicit false is the
		// ordinary case: the prompt is the complete handoff.
		inheritContext: params.inherit_context === true,
		advisor: params.advisor === true,
		runInBackground: params.run_in_background === true,
		isolated: params.isolated === true,
	};
}

export function resolveJoinMode(defaultJoinMode: JoinMode, runInBackground: boolean): JoinMode | undefined {
	return runInBackground ? defaultJoinMode : undefined;
}
