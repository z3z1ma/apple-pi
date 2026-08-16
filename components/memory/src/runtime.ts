import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { loadModeSpec } from "../../shared/src/mode-utils.js";
import { isThinkingLevel, type Config, DEFAULTS, loadConfig } from "./config.js";

export const OBSERVATIONAL_MEMORY_MODE = "observational-memory";

export type ResolveResult =
	| { ok: true; model: unknown; apiKey?: string; headers?: Record<string, string>; thinkingLevel?: ModelThinkingLevel }
	| { ok: false; reason: string };

/**
 * Mirrors pi's own request-auth acceptance rule (`AgentSession._getRequiredRequestAuth`):
 * resolved auth is usable when it carries an apiKey OR at least one header value.
 * OAuth providers (kimi-coding, xai, openai-codex, anthropic OAuth, …) authenticate via
 * `toAuth()` returning `{ headers: { Authorization: "Bearer …" } }` with no apiKey, and
 * pi-ai providers accept a caller-supplied Authorization header in place of an apiKey.
 */
function hasUsableAuth(auth: { apiKey?: unknown; headers?: unknown }): boolean {
	if (typeof auth.apiKey === "string" && auth.apiKey.length > 0) return true;
	if (auth.headers && typeof auth.headers === "object") {
		return Object.values(auth.headers as Record<string, unknown>).some(
			(value) => typeof value === "string" && value.length > 0,
		);
	}
	return false;
}

type NotifyLevel = "warning" | "info" | "error";
type Notify = (message: string, type?: NotifyLevel) => void;
export type ConsolidationPhase = "observer" | "reflector" | "dropper";

export interface ResolveCtx {
	/** Omit only for direct programmatic callers; normal Pi contexts always provide this. */
	cwd?: string;
	projectTrusted?: boolean;
	model: unknown;
	modelRegistry: any;
	hasUI: boolean;
	ui?: { notify: Notify };
}

export interface LaunchCtx {
	hasUI: boolean;
	ui?: { notify: Notify };
}

export class Runtime {
	config: Config = { ...DEFAULTS };
	configLoaded = false;
	consolidationInFlight = false;
	consolidationPromise: Promise<void> | null = null;
	consolidationPhase: ConsolidationPhase | undefined;
	compactInFlight = false;
	resolveFailureNotified = false;
	lastObserverError: string | undefined;
	lastReflectorError: string | undefined;
	lastDropperError: string | undefined;
	/** Deliberate-empty backoff (#23): skip observer re-fires over the same span until enough new tokens arrive. */
	observerEmptyBackoff:
		| {
				sessionIdentity: string | undefined;
				coverageId: string | undefined;
				tokensAtEmpty: number;
		  }
		| undefined;

	ensureConfig(cwd: string): void {
		if (this.configLoaded) return;
		this.config = loadConfig(cwd);
		this.configLoaded = true;
	}

	async resolveModel(ctx: ResolveCtx): Promise<ResolveResult> {
		const route = await loadModeSpec(ctx.cwd ?? process.cwd(), OBSERVATIONAL_MEMORY_MODE, ctx.projectTrusted === true);
		let model = ctx.model;
		if (route?.provider && route.modelId) {
			const configured = ctx.modelRegistry.find(route.provider, route.modelId);
			if (configured) {
				model = configured;
			} else if (ctx.hasUI && ctx.ui) {
				ctx.ui.notify(
					`Observational memory: configured mode ${route.provider}/${route.modelId} not found, using session model`,
					"warning",
				);
			}
		}
		if (!model)
			return {
				ok: false,
				reason: "no model available (session has no model and no observational-memory mode configured)",
			};
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		const provider = (model as { provider?: string }).provider ?? "unknown";
		if (!auth.ok || !hasUsableAuth(auth)) {
			const isOAuth = ctx.modelRegistry.isUsingOAuth?.(model) === true;
			const reason = isOAuth
				? `authentication failed for provider "${provider}" — OAuth credentials may have expired; run '/login ${provider}' to re-authenticate`
				: `no API key or auth headers for provider "${provider}"`;
			return { ok: false, reason };
		}
		const thinkingLevel = isThinkingLevel(route?.thinkingLevel) ? route.thinkingLevel : undefined;
		return {
			ok: true,
			model,
			apiKey: auth.apiKey as string | undefined,
			headers: auth.headers as Record<string, string> | undefined,
			...(thinkingLevel ? { thinkingLevel } : {}),
		};
	}

	launchConsolidationTask(ctx: LaunchCtx, work: () => Promise<void>): Promise<void> {
		this.consolidationInFlight = true;
		this.consolidationPhase = undefined;
		this.lastObserverError = undefined;
		this.lastReflectorError = undefined;
		this.lastDropperError = undefined;
		const promise = this.launchTrackedTask(ctx, "consolidation", work, () => {
			this.consolidationInFlight = false;
			this.consolidationPhase = undefined;
			if (this.consolidationPromise === promise) this.consolidationPromise = null;
		});
		this.consolidationPromise = promise;
		return promise;
	}

	recordConsolidationStageError(ctx: LaunchCtx, phase: ConsolidationPhase, error: unknown): string {
		const message = error instanceof Error ? error.message : String(error);
		if (phase === "observer") this.lastObserverError = message;
		if (phase === "reflector") this.lastReflectorError = message;
		if (phase === "dropper") this.lastDropperError = message;
		if (ctx.hasUI && ctx.ui) ctx.ui.notify(`Observational memory: ${phase} failed: ${message}`, "warning");
		return message;
	}

	private launchTrackedTask(
		ctx: LaunchCtx,
		label: string,
		work: () => Promise<void>,
		onFinally: (error: string | undefined) => void,
	): Promise<void> {
		const hasUI = ctx.hasUI;
		const ui = ctx.ui;
		return (async () => {
			let errorMessage: string | undefined;
			try {
				await work();
			} catch (error) {
				errorMessage = error instanceof Error ? error.message : String(error);
				if (hasUI && ui) ui.notify(`Observational memory: ${label} failed: ${errorMessage}`, "warning");
			} finally {
				onFinally(errorMessage);
			}
		})();
	}
}
