import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONSOLIDATION_ABORT_REASON } from "../src/abort.js";
import { isStaleExtensionCtxError, Runtime } from "../src/runtime.js";

const STALE_CTX_ERROR = new Error(
	"This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.reload().",
);

function modelRegistry(args: { found?: unknown; auth?: unknown } = {}) {
	return {
		find: vi.fn(() => args.found),
		getApiKeyAndHeaders: vi.fn(async () => args.auth ?? { ok: true, apiKey: "key", headers: { test: "yes" } }),
	};
}

describe("Runtime V3 behavior", () => {
	let agentDir: string;
	let previousAgentDir: string | undefined;

	beforeEach(() => {
		agentDir = mkdtempSync(join(tmpdir(), "om-runtime-"));
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = agentDir;
	});

	afterEach(() => {
		if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		rmSync(agentDir, { recursive: true, force: true });
	});

	it("uses the observational-memory mode when present", async () => {
		writeFileSync(
			join(agentDir, "modes.json"),
			JSON.stringify({
				modes: { "observational-memory": { provider: "anthropic", modelId: "configured", thinkingLevel: "max" } },
			}),
		);
		const runtime = new Runtime();
		const configured = { provider: "anthropic", id: "configured" };
		const registry = modelRegistry({ found: configured });

		const result = await runtime.resolveModel({
			cwd: agentDir,
			projectTrusted: false,
			model: { provider: "openai" },
			modelRegistry: registry,
			hasUI: false,
		});

		expect(registry.find).toHaveBeenCalledWith("anthropic", "configured");
		expect(result).toEqual({
			ok: true,
			model: configured,
			apiKey: "key",
			headers: { test: "yes" },
			thinkingLevel: "max",
		});
	});

	it("falls back to the session model and notifies when the configured mode model is missing", async () => {
		writeFileSync(
			join(agentDir, "modes.json"),
			JSON.stringify({
				modes: { "observational-memory": { provider: "anthropic", modelId: "missing" } },
			}),
		);
		const runtime = new Runtime();
		const notify = vi.fn();
		const sessionModel = { provider: "openai" };
		const registry = modelRegistry();

		const result = await runtime.resolveModel({
			cwd: agentDir,
			projectTrusted: false,
			model: sessionModel,
			modelRegistry: registry,
			hasUI: true,
			ui: { notify },
		});

		expect(result).toMatchObject({ ok: true, model: sessionModel });
		expect(notify).toHaveBeenCalledWith(
			"Observational memory: configured mode anthropic/missing not found, using session model",
			"warning",
		);
	});

	it("returns model resolution failures", async () => {
		const runtime = new Runtime();
		await expect(
			runtime.resolveModel({ model: undefined, modelRegistry: modelRegistry(), hasUI: false }),
		).resolves.toEqual({
			ok: false,
			reason: "no model available (session has no model and no observational-memory mode configured)",
		});

		const registry = modelRegistry({ auth: { ok: false } });
		await expect(
			runtime.resolveModel({ model: { provider: "anthropic" }, modelRegistry: registry, hasUI: false }),
		).resolves.toEqual({
			ok: false,
			reason: 'no API key or auth headers for provider "anthropic"',
		});
	});

	it("accepts OAuth-shaped auth (headers only, no apiKey)", async () => {
		const runtime = new Runtime();
		const model = { provider: "kimi-coding", id: "kimi-for-coding" };
		const registry = modelRegistry({
			auth: { ok: true, apiKey: undefined, headers: { Authorization: "Bearer oauth-token" } },
		});

		const result = await runtime.resolveModel({ model, modelRegistry: registry, hasUI: false });

		expect(result).toEqual({
			ok: true,
			model,
			apiKey: undefined,
			headers: { Authorization: "Bearer oauth-token" },
		});
	});

	it("accepts apiKey auth unchanged", async () => {
		const runtime = new Runtime();
		const model = { provider: "anthropic", id: "claude" };
		const registry = modelRegistry({ auth: { ok: true, apiKey: "sk-ant-key" } });

		const result = await runtime.resolveModel({ model, modelRegistry: registry, hasUI: false });

		expect(result).toEqual({ ok: true, model, apiKey: "sk-ant-key", headers: undefined });
	});

	it("rejects auth that carries neither apiKey nor usable headers", async () => {
		const runtime = new Runtime();
		const model = { provider: "xai" };

		for (const auth of [
			{ ok: true },
			{ ok: true, apiKey: "" },
			{ ok: true, headers: {} },
			{ ok: true, headers: { Authorization: "" } },
		]) {
			const registry = modelRegistry({ auth });
			await expect(runtime.resolveModel({ model, modelRegistry: registry, hasUI: false })).resolves.toEqual({
				ok: false,
				reason: 'no API key or auth headers for provider "xai"',
			});
		}
	});

	it("points OAuth providers at /login when auth resolution fails", async () => {
		const runtime = new Runtime();
		const model = { provider: "openai-codex", id: "gpt-5-codex" };
		const registry = {
			...modelRegistry({ auth: { ok: false, error: "refresh failed" } }),
			isUsingOAuth: vi.fn((candidate: { provider?: string }) => candidate?.provider === "openai-codex"),
		};

		const result = await runtime.resolveModel({ model, modelRegistry: registry, hasUI: false });

		expect(registry.isUsingOAuth).toHaveBeenCalledWith(model);
		expect(result).toEqual({
			ok: false,
			reason:
				"authentication failed for provider \"openai-codex\" — OAuth credentials may have expired; run '/login openai-codex' to re-authenticate",
		});
	});

	it("tracks consolidation task state", async () => {
		const runtime = new Runtime();
		let release: (() => void) | undefined;
		const work = new Promise<void>((resolve) => {
			release = resolve;
		});

		const promise = runtime.launchConsolidationTask({ hasUI: false }, async () => {
			runtime.consolidationPhase = "curator";
			await work;
		});

		expect(runtime.consolidationInFlight).toBe(true);
		expect(runtime.consolidationPromise).toBe(promise);
		expect(runtime.consolidationPhase).toBe("curator");
		release?.();
		await promise;
		expect(runtime.consolidationInFlight).toBe(false);
		expect(runtime.consolidationPromise).toBeNull();
		expect(runtime.consolidationPhase).toBeUndefined();
	});

	it("records curator consolidation errors", () => {
		const runtime = new Runtime();
		const notify = vi.fn();

		expect(
			runtime.recordConsolidationStageError({ hasUI: true, ui: { notify } }, "curator", new Error("curate failed")),
		).toBe("curate failed");

		expect(runtime.lastCuratorError).toBe("curate failed");
		expect(notify).toHaveBeenCalledWith("Observational memory: curator failed: curate failed", "warning");
	});

	it("does not record or notify stale extension ctx errors", () => {
		const runtime = new Runtime();
		const notify = vi.fn();

		expect(isStaleExtensionCtxError(STALE_CTX_ERROR)).toBe(true);
		expect(runtime.recordConsolidationStageError({ hasUI: true, ui: { notify } }, "curator", STALE_CTX_ERROR)).toBe(
			STALE_CTX_ERROR.message,
		);
		expect(runtime.lastCuratorError).toBeUndefined();
		expect(notify).not.toHaveBeenCalled();
	});

	it("does not notify when in-flight consolidation hits a stale extension ctx", async () => {
		const runtime = new Runtime();
		const notify = vi.fn();

		await runtime.launchConsolidationTask({ hasUI: true, ui: { notify } }, async () => {
			throw STALE_CTX_ERROR;
		});

		expect(notify).not.toHaveBeenCalled();
		expect(runtime.consolidationInFlight).toBe(false);
	});

	it("aborts in-flight consolidation on dispose", async () => {
		const runtime = new Runtime();
		let sawAbort: string | undefined;
		const promise = runtime.launchConsolidationTask({ hasUI: false }, async () => {
			await new Promise<void>((_, reject) => {
				const signal = runtime.consolidationSignal;
				if (!signal) throw new Error("expected consolidation signal");
				const onAbort = () => {
					sawAbort = signal.reason as string;
					reject(new Error(String(signal.reason)));
				};
				if (signal.aborted) onAbort();
				else signal.addEventListener("abort", onAbort, { once: true });
			});
		});

		runtime.dispose();
		await promise;
		expect(sawAbort).toBe(CONSOLIDATION_ABORT_REASON.disposed);
		expect(runtime.consolidationInFlight).toBe(false);
		expect(runtime.consolidationSignal).toBeUndefined();
	});

	it("does not notify when a new user turn aborts consolidation", async () => {
		const runtime = new Runtime();
		const notify = vi.fn();
		const promise = runtime.launchConsolidationTask({ hasUI: true, ui: { notify } }, async () => {
			await new Promise<void>((_, reject) => {
				const signal = runtime.consolidationSignal;
				if (!signal) throw new Error("expected consolidation signal");
				const onAbort = () => reject(new Error(String(signal.reason)));
				if (signal.aborted) onAbort();
				else signal.addEventListener("abort", onAbort, { once: true });
			});
		});

		runtime.abortConsolidation(CONSOLIDATION_ABORT_REASON.userTurn);
		await promise;
		expect(notify).not.toHaveBeenCalled();
		expect(runtime.disposed).toBe(false);
		expect(runtime.consolidationInFlight).toBe(false);
	});

	it("aborts consolidation when the hang timeout elapses", async () => {
		vi.useFakeTimers();
		const runtime = new Runtime();
		const notify = vi.fn();
		try {
			const promise = runtime.launchConsolidationTask(
				{ hasUI: true, ui: { notify } },
				async () => {
					await new Promise<void>((_, reject) => {
						const signal = runtime.consolidationSignal;
						if (!signal) throw new Error("expected consolidation signal");
						const onAbort = () => reject(new Error(String(signal.reason)));
						if (signal.aborted) onAbort();
						else signal.addEventListener("abort", onAbort, { once: true });
					});
				},
				{ timeoutMs: 25 },
			);

			await vi.advanceTimersByTimeAsync(25);
			await promise;
			expect(notify).toHaveBeenCalledWith(
				`Observational memory: consolidation failed: ${CONSOLIDATION_ABORT_REASON.timeout}`,
				"warning",
			);
			expect(runtime.consolidationInFlight).toBe(false);
		} finally {
			vi.useRealTimers();
		}
	});

	it("keeps auto-compaction state independent from consolidation", () => {
		const runtime = new Runtime();
		runtime.compactInFlight = true;
		expect(runtime.consolidationInFlight).toBe(false);
		expect(runtime.consolidationPhase).toBeUndefined();
	});

	it("reloads project observational-memory settings when cwd changes", () => {
		const first = join(agentDir, "first");
		const second = join(agentDir, "second");
		mkdirSync(join(first, ".pi"), { recursive: true });
		mkdirSync(join(second, ".pi"), { recursive: true });
		writeFileSync(
			join(first, ".pi", "settings.json"),
			JSON.stringify({ "observational-memory": { observeAfterTokens: 111, passive: true } }),
		);
		writeFileSync(
			join(second, ".pi", "settings.json"),
			JSON.stringify({ "observational-memory": { observeAfterTokens: 222 } }),
		);

		const runtime = new Runtime();
		expect(runtime.ensureConfig(first)).toMatchObject({ observeAfterTokens: 111, passive: true });
		expect(runtime.ensureConfig(first)).toMatchObject({ observeAfterTokens: 111, passive: true });
		expect(runtime.ensureConfig(second)).toMatchObject({ observeAfterTokens: 222, passive: false });
	});
});
