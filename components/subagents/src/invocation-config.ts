import type { AgentConfig, JoinMode, ThinkingLevel } from "./types.js";

interface AgentInvocationParams {
	thinking?: string;
	run_in_background?: boolean;
	isolated?: boolean;
}

export function resolveAgentInvocationConfig(
	agentConfig: AgentConfig | undefined,
	params: AgentInvocationParams,
): {
	thinking?: ThinkingLevel;
	maxTurns?: number;
	/** undefined = compact handoff, true = full parent branch, false = none. */
	inheritContext?: boolean;
	runInBackground: boolean;
	isolated: boolean;
} {
	return {
		thinking: (params.thinking ?? agentConfig?.thinking) as ThinkingLevel | undefined,
		// Turn ceilings are agent-definition or trusted-settings policy, never model arithmetic.
		maxTurns: agentConfig?.maxTurns,
		// Context breadth is trusted agent-definition policy: omitted is the
		// bounded handoff, true retains legacy full conversation, false opts out.
		inheritContext: agentConfig?.inheritContext,
		runInBackground: agentConfig?.runInBackground ?? params.run_in_background ?? false,
		isolated: agentConfig?.isolated ?? params.isolated ?? false,
	};
}

export function resolveJoinMode(defaultJoinMode: JoinMode, runInBackground: boolean): JoinMode | undefined {
	return runInBackground ? defaultJoinMode : undefined;
}
