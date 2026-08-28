import {
	type Api,
	type AssistantMessage,
	type Context,
	createAssistantMessageEventStream,
	getApiProvider,
	type Model,
} from "@earendil-works/pi-ai/compat";
import {
	AgentSession,
	type ExtensionAPI,
	type ExtensionContext,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
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

const PROACTIVE_OVERFLOW = Symbol.for("apple-pi.proactive-overflow");
const OVERFLOW_RECOVERY_PATCH = Symbol.for("apple-pi.proactive-overflow-recovery-patch");

const INTERNAL_OVERFLOW_ERROR = "proactive compaction token limit exceeded";

type ProviderStream = NonNullable<Parameters<ExtensionAPI["registerProvider"]>[1]["streamSimple"]>;

type ProactiveOverflowMessage = AssistantMessage & {
	[PROACTIVE_OVERFLOW]?: true;
};

type AgentSessionInternals = {
	_checkCompaction(message: AssistantMessage, skipAbortedCheck?: boolean): Promise<boolean>;
};

type AgentSessionPrototype = AgentSessionInternals & {
	[OVERFLOW_RECOVERY_PATCH]?: true;
};

type ArmedRequest = {
	api: Api;
	provider: string;
	model: string;
	toolCallIds: string[];
};

function includesArmedToolResults(model: Model<Api>, context: Context, request: ArmedRequest): boolean {
	if (model.api !== request.api || model.provider !== request.provider || model.id !== request.model) return false;
	const toolCallIds = new Set(
		context.messages.filter((message) => message.role === "toolResult").map((message) => message.toolCallId),
	);
	return request.toolCallIds.every((toolCallId) => toolCallIds.has(toolCallId));
}

/**
 * Pi exposes manual compaction but not its compact-and-retry entrypoint. Keep
 * the marked provider response benign at the event/UI boundary, then classify
 * it as overflow only while Pi's native recovery check runs.
 */
function installOverflowRecoveryPatch(): string | undefined {
	const prototype = AgentSession.prototype as unknown as AgentSessionPrototype;
	if (prototype[OVERFLOW_RECOVERY_PATCH]) return undefined;

	const descriptor = Object.getOwnPropertyDescriptor(prototype, "_checkCompaction");
	if (!descriptor || typeof descriptor.value !== "function") {
		return "Pi no longer exposes the expected compaction recovery method";
	}
	const original = descriptor.value;

	const patched = async function (
		this: AgentSessionInternals,
		message: AssistantMessage,
		skipAbortedCheck?: boolean,
	): Promise<boolean> {
		if (!(message as ProactiveOverflowMessage)[PROACTIVE_OVERFLOW]) {
			return original.call(this, message, skipAbortedCheck);
		}

		const stopReason = message.stopReason;
		const errorMessage = message.errorMessage;
		// Pi persisted this same object before checking compaction. Classifying it
		// only during recovery lets Pi remove it after rebuilding session state.
		message.stopReason = "error";
		message.errorMessage = INTERNAL_OVERFLOW_ERROR;
		try {
			return await original.call(this, message, skipAbortedCheck);
		} finally {
			message.stopReason = stopReason;
			message.errorMessage = errorMessage;
		}
	};

	try {
		Object.defineProperty(prototype, "_checkCompaction", { ...descriptor, value: patched });
		Object.defineProperty(prototype, OVERFLOW_RECOVERY_PATCH, { value: true });
	} catch (error) {
		Object.defineProperty(prototype, "_checkCompaction", descriptor);
		return error instanceof Error ? error.message : String(error);
	}
	return undefined;
}

function syntheticOverflow(model: Model<Api>) {
	const message: ProactiveOverflowMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: ZERO_USAGE,
		stopReason: "stop",
		timestamp: Date.now(),
		[PROACTIVE_OVERFLOW]: true,
	};
	const stream = createAssistantMessageEventStream();
	stream.push({ type: "done", reason: "stop", message });
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
 * marked completion enters Pi's native compact-and-retry path without exposing
 * the internal overflow signal as an assistant error.
 */
export function registerOverflowGuard(pi: ExtensionAPI, runtime: Runtime): void {
	const recoveryPatchError = installOverflowRecoveryPatch();
	let armed: ArmedRequest | undefined;
	const installedProviders = new Map<string, Api>();

	function clearArmed(): void {
		armed = undefined;
	}

	function intercept(model: Model<Api>, context: Context) {
		if (!armed || !includesArmedToolResults(model, context, armed)) return undefined;
		armed = undefined;
		return syntheticOverflow(model);
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
		const threshold = model.contextWindow - native.reserveTokens;
		if (tokens < threshold) return;

		const installError = recoveryPatchError ?? installProviderWrapper(model);
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
			toolCallIds: event.toolResults.map((result) => result.toolCallId),
		};
	});

	pi.on("model_select", clearArmed);
	pi.on("agent_end", clearArmed);
	pi.on("session_compact", clearArmed);
	pi.on("session_shutdown", clearArmed);
}
