import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Api, Model, ModelThinkingLevel } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fauxSession, type Reply } from "../../../tests/helpers/faux-session.js";
import installProviderFailover from "../src/controller.js";

const roots: string[] = [];
const sessions: Awaited<ReturnType<typeof fauxSession>>[] = [];
const quota = "Quota reached. Next: switch models or retry later.";

afterEach(() => {
	for (const run of sessions.splice(0)) run.dispose();
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function reply(model: Model<Api>, errorMessage?: string): Reply {
	return Object.assign(
		fauxAssistantMessage(errorMessage ? "" : "Recovered", {
			stopReason: errorMessage ? "error" : "stop",
			errorMessage,
		}),
		{ provider: model.provider, model: model.id, api: model.api },
	);
}

async function fixture(before?: ExtensionFactory, after?: ExtensionFactory, sourceProvider = "antigravity") {
	const root = mkdtempSync(join(tmpdir(), "apple-pi-failover-recovery-"));
	roots.push(root);
	const agentDir = join(root, "agent");
	mkdirSync(agentDir);
	vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
	vi.stubEnv("PI_PROGRAM_ID", "");
	let api!: ExtensionAPI;
	let ctx!: ExtensionContext;
	const select = vi.fn<(model: Model<Api>) => Promise<boolean>>();
	const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
	const replies: Reply[] = [];
	const installer: ExtensionFactory = (pi) => {
		api = pi;
		pi.on("session_start", (_event, context) => {
			ctx = context;
		});
		installProviderFailover(
			new Proxy(pi, {
				get(target, key, receiver) {
					return key === "setModel" ? select : Reflect.get(target, key, receiver);
				},
			}),
		);
	};
	const run = await fauxSession([...(before ? [before] : []), installer, ...(after ? [after] : [])], replies, [], {
		cwd: root,
	});
	sessions.push(run);
	const source = { ...run.session.model!, provider: sourceProvider, id: "source" } as Model<Api>;
	const target = {
		...source,
		provider: sourceProvider === "anthropic" ? "openai" : "anthropic",
		id: "target",
		reasoning: true,
	};
	const third = {
		...target,
		provider: ["antigravity", "anthropic", "openai"].find(
			(provider) => provider !== source.provider && provider !== target.provider,
		)!,
		id: "third",
	};
	const models = [source, target, third];
	vi.spyOn(ctx.modelRegistry, "find").mockImplementation((provider, id) =>
		models.find((model) => model.provider === provider && model.id === id),
	);
	const catalog = join(agentDir, "model-profiles.json");
	const profile = (choices: Model<Api>[], thinking: ModelThinkingLevel = "off") =>
		writeFileSync(
			catalog,
			JSON.stringify({
				profiles: {
					coordination: {
						selection: "ordered",
						models: choices.map((model) => ({ model: `${model.provider}/${model.id}`, thinking })),
					},
				},
			}),
		);
	profile(models);
	await api.setModel(source);
	select.mockImplementation((model) => api.setModel(model));
	const dispatch = vi.spyOn(run.session.modelRuntime, "streamSimple");
	const errors: { error: string }[] = [];
	await run.session.bindExtensions({ onError: (event) => errors.push(event) });
	return { run, source, target, third, select, dispatch, warnings, replies, errors, catalog, profile, api, ctx };
}

describe("provider failover caller recovery", () => {
	it("retains completed effects, earlier drafts and raw failure while continuing once", async () => {
		let effects = 0;
		const h = await fixture((pi) => {
			pi.registerTool({
				name: "bump",
				label: "Bump",
				description: "Record a completed effect",
				parameters: Type.Object({}),
				execute: async () => {
					effects++;
					return { content: [{ type: "text", text: "effect-completed" }], details: {} };
				},
			});
			pi.on("turn_end", (event) => {
				if (event.message.role === "assistant" && event.message.stopReason === "error")
					return {
						entries: [
							...event.entries,
							{ type: "custom" as const, customType: "earlier-boundary", data: { retained: true } },
						],
					};
			});
		});
		h.run.session.setActiveToolsByName(["bump"]);
		h.replies.push(
			Object.assign(fauxAssistantMessage(fauxToolCall("bump", {}, { id: "effect-1" }), { stopReason: "toolUse" }), {
				provider: h.source.provider,
				model: h.source.id,
				api: h.source.api,
			}),
			reply(h.source, quota),
			reply(h.target),
		);
		await h.run.session.prompt("Finish this task");
		expect(h.errors).toEqual([]);
		expect(h.select).toHaveBeenCalledOnce();
		expect(effects).toBe(1);
		expect(h.dispatch.mock.calls.map(([model]) => model.provider)).toEqual([
			h.source.provider,
			h.source.provider,
			h.target.provider,
		]);
		expect(JSON.stringify(h.run.requests[2]!.messages)).not.toContain(quota);
		expect(JSON.stringify(h.run.requests[2]!.messages)).toContain("effect-completed");
		const entries = h.run.session.sessionManager.getEntries();
		const failure = entries.find(
			(entry) => entry.type === "message" && entry.message.role === "assistant" && entry.message.errorMessage === quota,
		);
		expect(failure).toBeDefined();
		expect(entries).toContainEqual(
			expect.objectContaining({ type: "context_edit", targetId: failure!.id, replacement: null }),
		);
		expect(entries).toContainEqual(
			expect.objectContaining({ type: "custom", customType: "earlier-boundary", data: { retained: true } }),
		);
		expect(h.run.session.model).toMatchObject(h.target);
	});

	it("stops on refused selection without dispatching or restoring a model", async () => {
		const h = await fixture();
		h.select.mockResolvedValue(false);
		h.replies.push(reply(h.source, quota));
		await h.run.session.prompt("Finish this task");
		expect(h.errors).toEqual([]);
		expect(h.run.requests).toHaveLength(1);
		expect(h.select).toHaveBeenCalledOnce();
		expect(h.run.session.model).toMatchObject(h.source);
	});

	it("applies the existing profile effort only after quota failure", async () => {
		const h = await fixture();
		h.profile([h.source, h.target], "high");
		expect(h.run.session.thinkingLevel).toBe("off");
		h.replies.push(reply(h.source, quota), reply(h.target));
		await h.run.session.prompt("Finish this task");
		expect(h.errors).toEqual([]);
		expect(h.dispatch.mock.calls.map(([model]) => model.provider)).toEqual([h.source.provider, h.target.provider]);
		expect(h.run.session.thinkingLevel).toBe("high");
	});

	it("honors a manual selection before settlement without continuing the pending recovery", async () => {
		let changed = false;
		const h = await fixture((pi) => {
			pi.on("agent_before_settle", async (_event, ctx) => {
				if (ctx.model?.provider === "anthropic") {
					changed = true;
					await pi.setModel({ ...ctx.model, provider: "openai", id: "manual" });
				}
			});
		});
		h.replies.push(reply(h.source, quota));
		await h.run.session.prompt("Finish this task");
		expect(changed).toBe(true);
		expect(h.errors).toEqual([]);
		expect(h.run.requests).toHaveLength(1);
		expect(h.run.session.model).toMatchObject({ provider: "openai", id: "manual" });
	});

	it.each(["model", "effort"])(
		"stops an already-requested continuation when a later settlement handler changes %s",
		async (choice) => {
			let changed = false;
			const h = await fixture(undefined, (pi) => {
				pi.on("agent_before_settle", async (_event, ctx) => {
					if (changed || ctx.model?.provider !== "anthropic") return;
					changed = true;
					if (choice === "model") await pi.setModel({ ...ctx.model, provider: "openai", id: "manual" });
					else pi.setThinkingLevel("high");
				});
			});
			h.replies.push(
				reply(h.source, quota),
				reply(choice === "model" ? { ...h.target, provider: "openai", id: "manual" } : h.target),
			);
			await h.run.session.prompt("Finish this task");
			expect(changed).toBe(true);
			expect(h.errors).toEqual([]);
			expect(h.run.session.model).toMatchObject(choice === "model" ? { provider: "openai", id: "manual" } : h.target);
			if (choice === "effort") expect(h.run.session.thinkingLevel).toBe("high");
			expect(h.run.requests).toHaveLength(1);
		},
	);

	it("stops without selecting when no distinct eligible provider remains", async () => {
		const h = await fixture();
		h.profile([h.source]);
		h.replies.push(reply(h.source, quota));
		await h.run.session.prompt("Finish this task");
		expect(h.errors).toEqual([]);
		expect(h.select).not.toHaveBeenCalled();
		expect(h.run.requests).toHaveLength(1);
		expect(h.warnings).toHaveBeenCalledWith(expect.stringContaining("no eligible distinct provider"));
	});

	it("clears pending continuation on an unknown target error", async () => {
		const h = await fixture();
		h.replies.push(reply(h.source, quota), reply(h.target, "Unrecognized provider failure"));
		await h.run.session.prompt("Finish this task");
		expect(h.errors).toEqual([]);
		expect(h.run.requests).toHaveLength(2);
		expect(h.select).toHaveBeenCalledOnce();
		expect(h.run.session.model).toMatchObject(h.target);
	});

	it("bounds distinct-provider selection across a native retry without an extra settlement request", async () => {
		const h = await fixture();
		h.run.session.settingsManager.applyOverrides({ retry: { baseDelayMs: 1 } });
		h.replies.push(
			reply(h.source, quota),
			reply(
				h.target,
				'429 {"error":{"type":"rate_limit_error","details":{"error_code":"enforced_spend_limit_reached"}}}',
			),
			reply(h.third),
		);
		await h.run.session.prompt("Finish this task");
		expect(h.errors).toEqual([]);
		expect(h.run.requests).toHaveLength(3);
		expect(h.select.mock.calls.map(([model]) => model.provider)).toEqual(["anthropic", "openai"]);
	});

	it.each([
		["openai", 'OpenAI API error (429): {"error":{"code":"subscription_sharing_usage_limit_exceeded"}}', false],
		["openai", 'OpenAI API error (429): {"error":{"code":"credit_balance_exhausted"}}', true],
		["openai", 'OpenAI API error (429): {"error":{"code":"organization_spend_limit_exceeded"}}', true],
		["openai", 'OpenAI API error (429): {"error":{"code":"project_spend_limit_exceeded"}}', true],
		["openai", 'OpenAI API error (429): {"error":{"code":"organization_usage_limit_exceeded"}}', true],
		[
			"anthropic",
			'429 {"error":{"type":"rate_limit_error","details":{"error_code":"enforced_spend_limit_reached"}}}',
			true,
		],
		["antigravity", quota, false],
	])(
		"automatically dispatches a different provider with default retry settings: %s %s",
		async (provider, error, nativeRetry) => {
			const h = await fixture(undefined, undefined, provider);
			const retries: unknown[] = [];
			h.run.session.subscribe((event) => {
				if (event.type === "auto_retry_start") retries.push(event);
			});
			h.replies.push(reply(h.source, error), reply(h.target));
			await h.run.session.prompt("Finish this task");
			expect(h.errors).toEqual([]);
			expect(h.dispatch.mock.calls.map(([model]) => model.provider)).toEqual([h.source.provider, h.target.provider]);
			expect(retries).toHaveLength(nativeRetry ? 1 : 0);
		},
	);

	it("leaves a switched model waiting when native retry is disabled for a retryable spend failure", async () => {
		const h = await fixture(undefined, undefined, "anthropic");
		h.run.session.settingsManager.applyOverrides({ retry: { enabled: false } });
		h.replies.push(
			reply(
				h.source,
				'429 {"error":{"type":"rate_limit_error","details":{"error_code":"enforced_spend_limit_reached"}}}',
			),
		);
		await h.run.session.prompt("Finish this task");
		expect(h.errors).toEqual([]);
		expect(h.dispatch.mock.calls.map(([model]) => model.provider)).toEqual([h.source.provider]);
		expect(h.run.session.model).toMatchObject(h.target);
	});

	it("does not override an exhausted native retry budget with a settlement request", async () => {
		const h = await fixture(undefined, undefined, "anthropic");
		h.run.session.settingsManager.applyOverrides({ retry: { maxRetries: 1, baseDelayMs: 1 } });
		h.replies.push(
			reply(h.source, "503 overloaded"),
			reply(
				h.source,
				'429 {"error":{"type":"rate_limit_error","details":{"error_code":"enforced_spend_limit_reached"}}}',
			),
		);
		await h.run.session.prompt("Finish this task");
		expect(h.errors).toEqual([]);
		expect(h.dispatch.mock.calls.map(([model]) => model.provider)).toEqual([h.source.provider, h.source.provider]);
		expect(h.run.session.model).toMatchObject(h.target);
	});

	it("does not revive a cancelled native retry countdown after switching provider", async () => {
		const h = await fixture(undefined, undefined, "anthropic");
		let started!: () => void;
		const retryStarted = new Promise<void>((resolve) => {
			started = resolve;
		});
		h.run.session.subscribe((event) => {
			if (event.type === "auto_retry_start") started();
		});
		h.replies.push(
			reply(
				h.source,
				'429 {"error":{"type":"rate_limit_error","details":{"error_code":"enforced_spend_limit_reached"}}}',
			),
		);
		const running = h.run.session.prompt("Finish this task");
		await retryStarted;
		h.run.session.abortRetry();
		await running;
		expect(h.errors).toEqual([]);
		expect(h.dispatch.mock.calls.map(([model]) => model.provider)).toEqual([h.source.provider]);
		expect(h.run.session.model).toMatchObject(h.target);
	});

	it.each(["manual", "abort"])(
		"records the installed setter's late auth commit after %s without another request",
		async (interruption) => {
			const h = await fixture();
			let release!: () => void;
			let reached!: () => void;
			const blocked = new Promise<void>((resolve) => {
				release = resolve;
			});
			const entered = new Promise<void>((resolve) => {
				reached = resolve;
			});
			const runtime = h.run.session.modelRuntime;
			const checkAuth = runtime.checkAuth.bind(runtime);
			let held = false;
			vi.spyOn(runtime, "checkAuth").mockImplementation(async (provider) => {
				if (provider === h.target.provider && !held) {
					held = true;
					reached();
					await blocked;
				}
				return checkAuth(provider);
			});
			h.replies.push(reply(h.source, quota));
			const running = h.run.session.prompt("Finish this task");
			await entered;
			let aborted: Promise<void> | undefined;
			if (interruption === "manual") await h.api.setModel({ ...h.third, id: "manual" });
			else aborted = h.run.session.abort();
			release();
			await Promise.all([running, aborted]);
			expect(h.errors).toEqual([]);
			expect(h.dispatch.mock.calls.map(([model]) => model.provider)).toEqual([h.source.provider]);
			expect(h.run.session.model).toMatchObject(h.target);
		},
	);

	it("reports an expected missing profile once without an extension crash", async () => {
		const h = await fixture();
		rmSync(h.catalog);
		h.replies.push(reply(h.source, quota));
		await h.run.session.prompt("Finish this task");
		expect(h.warnings).toHaveBeenCalledOnce();
		expect(h.errors).toEqual([]);
		expect(h.select).not.toHaveBeenCalled();
		expect(h.run.requests).toHaveLength(1);
	});

	it("keeps unexpected destination errors visible", async () => {
		const h = await fixture();
		vi.spyOn(h.ctx.modelRegistry, "find").mockImplementation(() => {
			throw new Error("Unexpected registry failure");
		});
		h.replies.push(reply(h.source, quota));
		await h.run.session.prompt("Finish this task");
		expect(h.warnings).toHaveBeenCalledOnce();
		expect(h.errors).toEqual([expect.objectContaining({ error: "Unexpected registry failure" })]);
		expect(h.run.requests).toHaveLength(1);
	});
});
