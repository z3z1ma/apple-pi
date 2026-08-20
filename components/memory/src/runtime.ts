import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { resolveModelProfile } from "../../shared/src/model-profiles.js";
import { CONSOLIDATION_ABORT_REASON, type ConsolidationAbortReason, isQuietConsolidationAbort } from "./abort.js";
import { type Config, DEFAULTS, loadConfig } from "./config.js";

export const OBSERVATIONAL_MEMORY_PROFILE = "background";

/** Wall-clock cap for one curation pass. Hang backstop, not a quality target. */
export const CONSOLIDATION_HANG_TIMEOUT_MS = 15 * 60 * 1000;

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
export type ConsolidationPhase = "curator";

const STALE_EXTENSION_CTX_MESSAGE = "This extension ctx is stale after session replacement or reload";

export function isStaleExtensionCtxError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes(STALE_EXTENSION_CTX_MESSAGE);
}

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
	configCwd: string | undefined;
	/** True after session_shutdown / replacement; in-flight work must not use captured pi/ctx. */
	disposed = false;
	consolidationInFlight = false;
	consolidationPromise: Promise<void> | null = null;
	consolidationPhase: ConsolidationPhase | undefined;
	private consolidationAbort: AbortController | null = null;
	private consolidationTimeout: ReturnType<typeof setTimeout> | null = null;
	compactInFlight = false;
	resolveFailureNotified = false;
	lastCuratorError: string | undefined;
	/** Deliberate-empty backoff (#23): skip observer re-fires over the same span until enough new tokens arrive. */
	observerEmptyBackoff:
		| {
				sessionIdentity: string | undefined;
				coverageId: string | undefined;
				tokensAtEmpty: number;
		  }
		| undefined;
	/** Skip reflector re-fires over the same observation coverage after a completed pass. */
	reflectorMaintenanceBackoff:
		| {
				sessionIdentity: string | undefined;
				observationCoverageId: string | undefined;
				tokensAtEmpty: number;
		  }
		| undefined;
	/** Deliberate no-drop backoff: skip dropper re-fires over the same law and working set. */
	dropperNoDropBackoff:
		| {
				sessionIdentity: string | undefined;
				lawFingerprint: string;
				observationFingerprint: string;
				tokensAtEmpty: number;
		  }
		| undefined;

	get consolidationSignal(): AbortSignal | undefined {
		return this.consolidationAbort?.signal;
	}

	abortConsolidation(reason: ConsolidationAbortReason): void {
		this.consolidationAbort?.abort(reason);
	}

	dispose(): void {
		this.disposed = true;
		this.abortConsolidation(CONSOLIDATION_ABORT_REASON.disposed);
	}

	private clearConsolidationTimeout(): void {
		if (this.consolidationTimeout === null) return;
		clearTimeout(this.consolidationTimeout);
		this.consolidationTimeout = null;
	}

	ensureConfig(cwd: string): Config {
		if (this.configLoaded && (this.configCwd === cwd || this.configCwd === undefined)) {
			this.configCwd = cwd;
			return this.config;
		}
		this.config = loadConfig(cwd);
		this.configCwd = cwd;
		this.configLoaded = true;
		return this.config;
	}

	async resolveModel(ctx: ResolveCtx): Promise<ResolveResult> {
		let resolved: ReturnType<typeof resolveModelProfile>;
		try {
			resolved = resolveModelProfile(OBSERVATIONAL_MEMORY_PROFILE, ctx.modelRegistry);
		} catch (error) {
			return { ok: false, reason: error instanceof Error ? error.message : String(error) };
		}
		const model = resolved.model;
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		const provider = (model as { provider?: string }).provider ?? "unknown";
		if (!auth.ok || !hasUsableAuth(auth)) {
			const isOAuth = ctx.modelRegistry.isUsingOAuth?.(model) === true;
			const reason = isOAuth
				? `authentication failed for provider "${provider}" — OAuth credentials may have expired; run '/login ${provider}' to re-authenticate`
				: `no API key or auth headers for provider "${provider}"`;
			return { ok: false, reason };
		}
		return {
			ok: true,
			model,
			apiKey: auth.apiKey as string | undefined,
			headers: auth.headers as Record<string, string> | undefined,
			thinkingLevel: resolved.thinking,
		};
	}

	launchConsolidationTask(
		ctx: LaunchCtx,
		work: () => Promise<void>,
		options: { timeoutMs?: number } = {},
	): Promise<void> {
		this.consolidationInFlight = true;
		this.consolidationPhase = undefined;
		this.lastCuratorError = undefined;
		const controller = new AbortController();
		this.consolidationAbort = controller;
		this.clearConsolidationTimeout();
		const timeoutMs = options.timeoutMs ?? CONSOLIDATION_HANG_TIMEOUT_MS;
		const timeout = setTimeout(() => {
			if (this.consolidationAbort === controller && !controller.signal.aborted) {
				controller.abort(CONSOLIDATION_ABORT_REASON.timeout);
			}
		}, timeoutMs);
		timeout.unref?.();
		this.consolidationTimeout = timeout;
		const promise = this.launchTrackedTask(ctx, "consolidation", work, () => {
			this.clearConsolidationTimeout();
			if (this.consolidationAbort === controller) this.consolidationAbort = null;
			this.consolidationInFlight = false;
			this.consolidationPhase = undefined;
			if (this.consolidationPromise === promise) this.consolidationPromise = null;
		});
		this.consolidationPromise = promise;
		return promise;
	}

	recordConsolidationStageError(ctx: LaunchCtx, phase: ConsolidationPhase, error: unknown): string {
		const message = error instanceof Error ? error.message : String(error);
		if (isStaleExtensionCtxError(error) || isQuietConsolidationAbort(error)) return message;
		this.lastCuratorError = message;
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
				if (hasUI && ui && !isStaleExtensionCtxError(error) && !isQuietConsolidationAbort(error)) {
					ui.notify(`Observational memory: ${label} failed: ${errorMessage}`, "warning");
				}
			} finally {
				onFinally(errorMessage);
			}
		})();
	}
}
