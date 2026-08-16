import type { AgentConfig, JoinMode, ThinkingLevel } from "./types.js";

interface AgentInvocationParams {
	thinking?: string;
	max_turns?: number;
	run_in_background?: boolean;
	inherit_context?: boolean;
	isolated?: boolean;
}

export function resolveAgentInvocationConfig(
	agentConfig: AgentConfig | undefined,
	params: AgentInvocationParams,
): {
	thinking?: ThinkingLevel;
	maxTurns?: number;
	inheritContext: boolean;
	runInBackground: boolean;
	isolated: boolean;
} {
	return {
		thinking: (params.thinking ?? agentConfig?.thinking) as ThinkingLevel | undefined,
		maxTurns: agentConfig?.maxTurns ?? params.max_turns,
		inheritContext: agentConfig?.inheritContext ?? params.inherit_context ?? false,
		runInBackground: agentConfig?.runInBackground ?? params.run_in_background ?? false,
		isolated: agentConfig?.isolated ?? params.isolated ?? false,
	};
}

export function resolveJoinMode(defaultJoinMode: JoinMode, runInBackground: boolean): JoinMode | undefined {
	return runInBackground ? defaultJoinMode : undefined;
}
