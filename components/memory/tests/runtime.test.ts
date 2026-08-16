import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Runtime } from "../src/runtime.js";

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
		writeFileSync(join(agentDir, "modes.json"), JSON.stringify({
			modes: { "observational-memory": { provider: "anthropic", modelId: "configured", thinkingLevel: "max" } },
		}));
		const runtime = new Runtime();
		const configured = { provider: "anthropic", id: "configured" };
		const registry = modelRegistry({ found: configured });

		const result = await runtime.resolveModel({ cwd: agentDir, projectTrusted: false, model: { provider: "openai" }, modelRegistry: registry, hasUI: false });

		expect(registry.find).toHaveBeenCalledWith("anthropic", "configured");
		expect(result).toEqual({ ok: true, model: configured, apiKey: "key", headers: { test: "yes" }, thinkingLevel: "max" });
	});

	it("falls back to the session model and notifies when the configured mode model is missing", async () => {
		writeFileSync(join(agentDir, "modes.json"), JSON.stringify({
			modes: { "observational-memory": { provider: "anthropic", modelId: "missing" } },
		}));
		const runtime = new Runtime();
		const notify = vi.fn();
		const sessionModel = { provider: "openai" };
		const registry = modelRegistry();

		const result = await runtime.resolveModel({ cwd: agentDir, projectTrusted: false, model: sessionModel, modelRegistry: registry, hasUI: true, ui: { notify } });

		expect(result).toMatchObject({ ok: true, model: sessionModel });
		expect(notify).toHaveBeenCalledWith(
			"Observational memory: configured mode anthropic/missing not found, using session model",
			"warning",
		);
	});

	it("returns model resolution failures", async () => {
		const runtime = new Runtime();
		await expect(runtime.resolveModel({ model: undefined, modelRegistry: modelRegistry(), hasUI: false })).resolves.toEqual({
			ok: false,
			reason: "no model available (session has no model and no observational-memory mode configured)",
		});

		const registry = modelRegistry({ auth: { ok: false } });
		await expect(runtime.resolveModel({ model: { provider: "anthropic" }, modelRegistry: registry, hasUI: false })).resolves.toEqual({
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
			reason: 'authentication failed for provider "openai-codex" — OAuth credentials may have expired; run \'/login openai-codex\' to re-authenticate',
		});
	});

	it("tracks consolidation task state", async () => {
		const runtime = new Runtime();
		let release: (() => void) | undefined;
		const work = new Promise<void>((resolve) => {
			release = resolve;
		});

		const promise = runtime.launchConsolidationTask({ hasUI: false }, async () => {
			runtime.consolidationPhase = "observer";
			await work;
		});

		expect(runtime.consolidationInFlight).toBe(true);
		expect(runtime.consolidationPromise).toBe(promise);
		expect(runtime.consolidationPhase).toBe("observer");
		release?.();
		await promise;
		expect(runtime.consolidationInFlight).toBe(false);
		expect(runtime.consolidationPromise).toBeNull();
		expect(runtime.consolidationPhase).toBeUndefined();
	});

	it("records stage-specific consolidation errors", () => {
		const runtime = new Runtime();
		const notify = vi.fn();

		expect(runtime.recordConsolidationStageError({ hasUI: true, ui: { notify } }, "observer", new Error("observe failed"))).toBe("observe failed");
		expect(runtime.recordConsolidationStageError({ hasUI: true, ui: { notify } }, "reflector", new Error("reflect failed"))).toBe("reflect failed");
		expect(runtime.recordConsolidationStageError({ hasUI: true, ui: { notify } }, "dropper", "drop failed")).toBe("drop failed");

		expect(runtime.lastObserverError).toBe("observe failed");
		expect(runtime.lastReflectorError).toBe("reflect failed");
		expect(runtime.lastDropperError).toBe("drop failed");
		expect(notify).toHaveBeenCalledWith("Observational memory: observer failed: observe failed", "warning");
		expect(notify).toHaveBeenCalledWith("Observational memory: reflector failed: reflect failed", "warning");
		expect(notify).toHaveBeenCalledWith("Observational memory: dropper failed: drop failed", "warning");
	});

	it("keeps auto-compaction state independent from consolidation", () => {
		const runtime = new Runtime();
		runtime.compactInFlight = true;
		expect(runtime.consolidationInFlight).toBe(false);
		expect(runtime.consolidationPhase).toBeUndefined();
	});
});
