import type { Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { INFERENCE_PROFILE_NAMES, resolveModelProfile } from "../../shared/src/model-profiles.js";
import type { AgentConfig, ThinkingLevel } from "./types.js";

export const INFERENCE_PROFILE_PARAMETER_SCHEMA = Type.Union(
	INFERENCE_PROFILE_NAMES.map((profile) => Type.Literal(profile)),
	{
		description:
			"User-global inference profile override. Selects model/thinking only and must be one of the known inference profiles.",
	},
);

interface ModelRegistry {
	find(provider: string, modelId: string): Model<any> | undefined;
}

export interface AgentProfileResolution {
	model: Model<any> | undefined;
	thinkingLevel?: ThinkingLevel;
	/** Exact profile value for CLI transports that accept an explicit off level. */
	thinking?: ModelThinkingLevel;
	profile?: string;
	error?: string;
}

/**
 * Resolve the model profile selected by an invocation or agent definition.
 * Profiles change inference resources only; the agent type remains the owner of
 * prompts, tools, permissions, and lifecycle policy.
 */
export function resolveAgentProfile(args: {
	registry: ModelRegistry;
	parentModel?: Model<any>;
	parentThinking?: ModelThinkingLevel;
	config?: Partial<AgentConfig>;
	explicitProfile?: string;
}): AgentProfileResolution {
	const { registry, parentModel, parentThinking, config, explicitProfile } = args;
	const profile = explicitProfile ?? config?.profile;
	if (!profile) {
		return {
			model: parentModel,
			thinking: parentThinking,
			thinkingLevel: parentThinking,
		};
	}
	try {
		const resolved = resolveModelProfile(profile, registry);
		return {
			model: resolved.model,
			thinking: resolved.thinking,
			thinkingLevel: resolved.thinking,
			profile: resolved.name,
		};
	} catch (error) {
		return {
			model: undefined,
			profile,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
