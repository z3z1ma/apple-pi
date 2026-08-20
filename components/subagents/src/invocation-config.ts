import type { AgentConfig, JoinMode } from "./types.js";

interface AgentInvocationParams {
	run_in_background?: boolean;
	isolated?: boolean;
	inherit_context?: boolean;
	advisor?: boolean;
	system_prompt?: string;
}

export function resolveAgentInvocationConfig(
	agentConfig: AgentConfig | undefined,
	params: AgentInvocationParams,
): {
	maxTurns?: number;
	/** Invocation-level guidance appended after the selected definition. */
	systemPrompt?: string;
	/** undefined = compact handoff, true = full parent branch, false = none. */
	inheritContext: boolean;
	advisor: boolean;
	runInBackground: boolean;
	isolated: boolean;
} {
	return {
		// Turn ceilings are agent-definition or trusted-settings policy, never model arithmetic.
		maxTurns: agentConfig?.maxTurns,
		systemPrompt: params.system_prompt?.trim() || undefined,
		// Context inheritance belongs to each invocation. Advisor may have a trusted
		// definition default; an explicit invocation boolean wins, including false.
		inheritContext: params.inherit_context === true,
		advisor: params.advisor ?? agentConfig?.advisor ?? false,
		runInBackground: params.run_in_background === true,
		isolated: params.isolated === true,
	};
}

export function resolveJoinMode(defaultJoinMode: JoinMode, runInBackground: boolean): JoinMode | undefined {
	return runInBackground ? defaultJoinMode : undefined;
}
