import { type ExtensionAPI, type ExtensionContext, SettingsManager } from "@earendil-works/pi-coding-agent";
import {
	createAssistantMessageEventStream,
	getApiProvider,
	type Api,
	type AssistantMessage,
	type Context,
	type Model,
} from "@earendil-works/pi-ai/compat";
import { resolveCompactAfterTokens } from "../config.js";
import type { Runtime } from "../runtime.js";

const ZERO_USAGE = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0,
	},
};

type ProviderStream = NonNullable<Parameters<ExtensionAPI["registerProvider"]>[1]["streamSimple"]>;

type ArmedRequest = {
	api: Api;
	provider: string;
	model: string;
	threshold: number;
	tokens: number;
	toolCallIds: string[];
};

function includesArmedToolResults(model: Model<Api>, context: Context, request: ArmedRequest): boolean {
	if (model.api !== request.api || model.provider !== request.provider || model.id !== request.model) return false;
	const toolCallIds = new Set(
		context.messages.filter((message) => message.role === "toolResult").map((message) => message.toolCallId),
	);
	return request.toolCallIds.every((toolCallId) => toolCallIds.has(toolCallId));
}

function syntheticOverflow(model: Model<Api>, request: ArmedRequest) {
	const message: AssistantMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: ZERO_USAGE,
		stopReason: "error",
		errorMessage: `proactive compaction token limit exceeded (${request.tokens.toLocaleString()} >= ${request.threshold.toLocaleString()} tokens)`,
		timestamp: Date.now(),
	};
	const stream = createAssistantMessageEventStream();
	stream.push({ type: "error", reason: "error", error: message });
	stream.end(message);
	return stream;
}

function nativeCompactionSettings(ctx: ExtensionContext) {
	return SettingsManager.create(ctx.cwd, undefined, {
		projectTrusted: ctx.isProjectTrusted(),
	}).getCompactionSettings();
}

/**
 * Stop an oversized post-tool request before it reaches the provider. The
 * synthetic overflow deliberately enters Pi's native compact-and-retry path,
 * which preserves the current agent run and continues it after compaction.
 */
export function registerOverflowGuard(pi: ExtensionAPI, runtime: Runtime): void {
	let armed: ArmedRequest | undefined;
	const installedProviders = new Map<string, Api>();

	function clearArmed(): void {
		armed = undefined;
	}

	function intercept(model: Model<Api>, context: Context) {
		if (!armed || !includesArmedToolResults(model, context, armed)) return undefined;
		const request = armed;
		armed = undefined;
		return syntheticOverflow(model, request);
	}

	function installProviderWrapper(model: Model<Api>): string | undefined {
		if (installedProviders.get(model.provider) === model.api) return undefined;
		const upstream = getApiProvider(model.api);
		if (!upstream) return `no provider stream is registered for ${model.api}`;
		const streamSimple: ProviderStream = (requestModel, context, options) =>
			intercept(requestModel, context) ?? upstream.streamSimple(requestModel, context, options);
		try {
			pi.registerProvider(model.provider, { api: model.api, streamSimple });
		} catch (error) {
			return error instanceof Error ? error.message : String(error);
		}
		installedProviders.set(model.provider, model.api);
		return undefined;
	}

	pi.on("turn_end", (event, ctx) => {
		if (event.toolResults.length === 0) return;
		runtime.ensureConfig(ctx.cwd);
		if (runtime.config.passive) return;

		const model = ctx.model;
		const tokens = ctx.getContextUsage()?.tokens;
		if (!model || typeof tokens !== "number" || !Number.isFinite(tokens)) return;

		const native = nativeCompactionSettings(ctx);
		if (!native.enabled) return;
		const configuredThreshold = resolveCompactAfterTokens(runtime.config, model.contextWindow);
		const threshold = Math.min(configuredThreshold, model.contextWindow - native.reserveTokens);
		if (tokens < threshold) return;

		const installError = installProviderWrapper(model);
		if (installError) {
			ctx.ui?.notify?.(
				`Proactive compaction stopped ${model.provider}/${model.id} before an unguarded oversized request: ${installError}`,
				"error",
			);
			ctx.abort();
			return;
		}

		armed = {
			api: model.api,
			provider: model.provider,
			model: model.id,
			threshold,
			tokens,
			toolCallIds: event.toolResults.map((result) => result.toolCallId),
		};
	});

	pi.on("model_select", clearArmed);
	pi.on("agent_end", clearArmed);
	pi.on("session_compact", clearArmed);
	pi.on("session_shutdown", clearArmed);
}
