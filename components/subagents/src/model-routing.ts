import type { Model } from "@earendil-works/pi-ai";
import { loadModeSpec } from "../../mode-utils.js";
import { resolveModel } from "./model-resolver.js";
import type { AgentConfig, ThinkingLevel } from "./types.js";

interface ModelRegistry {
	find(provider: string, modelId: string): Model<any> | undefined;
	getAvailable?(): Array<{ provider: string; id: string }>;
}

type AgentModelResolution = {
	model: Model<any> | undefined;
	thinkingLevel?: ThinkingLevel;
	error?: string;
};

function resolveConfiguredModel(
	input: string,
	registry: ModelRegistry,
): Model<any> | string {
	return resolveModel(input, registry as any) as Model<any> | string;
}

/**
 * Resolve the model and thinking level for an agent invocation.
 *
 * Model precedence is: explicit invocation > custom frontmatter > built-in
 * modes.json route > embedded built-in fallback > parent. Thinking is resolved
 * independently, so a route may set only `thinkingLevel`.
 */
export async function resolveAgentModel(args: {
	cwd?: string;
	projectTrusted?: boolean;
	registry: ModelRegistry;
	parentModel?: Model<any>;
	config?: Partial<AgentConfig>;
	type?: string;
	explicitModel?: string;
}): Promise<AgentModelResolution> {
	const { cwd = process.cwd(), projectTrusted = false, registry, parentModel, config, type, explicitModel } = args;
	const configThinking = config?.thinking as ThinkingLevel | undefined;

	if (explicitModel) {
		const model = resolveConfiguredModel(explicitModel, registry);
		return typeof model === "string"
			? { model: parentModel, thinkingLevel: configThinking, error: model }
			: { model, thinkingLevel: configThinking };
	}

	// A Markdown definition replaces a built-in agent, including its model policy.
	if (config && config.isDefault !== true && config.model) {
		const model = resolveConfiguredModel(config.model, registry);
		return typeof model === "string"
			? { model: parentModel, thinkingLevel: configThinking, error: model }
			: { model, thinkingLevel: configThinking };
	}

	if (config?.isDefault === true) {
		const route = type ? await loadModeSpec(cwd, type, projectTrusted) : undefined;
		const routeModel = route?.provider && route.modelId
			? registry.find(route.provider, route.modelId)
			: undefined;
		const thinkingLevel = (route?.thinkingLevel as ThinkingLevel | undefined) ?? configThinking;

		if (routeModel) return { model: routeModel, thinkingLevel };

		if (config.model) {
			const embeddedModel = resolveConfiguredModel(config.model, registry);
			// Embedded models are defaults, not configuration requirements. Preserve
			// the historical fallback to the caller's model when one is unavailable.
			if (typeof embeddedModel !== "string") return { model: embeddedModel, thinkingLevel };
		}
		return { model: parentModel, thinkingLevel };
	}

	return { model: parentModel, thinkingLevel: configThinking };
}
