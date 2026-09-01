import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context, Model } from "@earendil-works/pi-ai";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	type ProviderRequestOptions,
} from "@earendil-works/pi-ai/compat";
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";

function responseStream(text: string) {
	const message = fauxAssistantMessage(text);
	const stream = createAssistantMessageEventStream();
	stream.push({ type: "done", reason: "stop", message });
	stream.end(message);
	return stream;
}

it("keeps compaction and branch summarization on the raw stream outside before_provider_request", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "apple-pi-xai-summary-"));
	mkdirSync(join(cwd, "agent"));
	const model = {
		id: "grok-4.6",
		name: "Grok 4.6",
		api: "openai-responses",
		provider: "xai",
		baseUrl: "https://api.x.ai/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 10_000,
	} as Model<"openai-responses">;
	const calls: Array<{
		kind: "agent" | "summary";
		hasPayloadHook: boolean;
		payload: Record<string, unknown>;
	}> = [];
	const stream = (requestModel: Model<"openai-responses">, context: Context, options: ProviderRequestOptions) => {
		const payload = { model: requestModel.id };
		const hasPayloadHook = typeof options.onPayload === "function";
		const kind: "summary" | "agent" = context.tools === undefined ? "summary" : "agent";
		const record: (typeof calls)[number] = { kind, hasPayloadHook, payload };
		calls.push(record);
		if (options.onPayload) {
			void Promise.resolve(options.onPayload(payload, requestModel)).then((replacement) => {
				if (replacement && typeof replacement === "object") record.payload = replacement as Record<string, unknown>;
			});
		}
		return responseStream(kind === "summary" ? "compacted history" : "ordinary response");
	};
	const modelRuntime = {
		getModel: () => model,
		getModels: () => [model],
		getProvider: () => undefined,
		getProviders: () => [],
		getAvailable: async () => [model],
		getAvailableSnapshot: () => [model],
		getError: () => undefined,
		hasConfiguredAuth: () => true,
		checkAuth: async () => ({ ok: true }),
		isUsingOAuth: () => false,
		isUsingSubscription: () => false,
		getAuth: async () => ({ auth: { apiKey: "faux", headers: {} } }),
		getProviderAuthStatus: () => "configured",
		getCompatibilityRequestConfig: () => ({}),
		getRegisteredProviderIds: () => [],
		getRegisteredProviderConfig: () => undefined,
		getRegisteredNativeProvider: () => undefined,
		registerProvider: () => {},
		registerNativeProvider: () => {},
		unregisterProvider: () => {},
		refresh: async () => ({}),
		stream,
		streamSimple: stream,
	};
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: join(cwd, "agent"),
		additionalExtensionPaths: [join(process.cwd(), "extensions", "xai-hosted-tools.ts")],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPromptOverride: () => "test",
		appendSystemPromptOverride: () => [],
	});
	await loader.reload();
	const sessionManager = SessionManager.inMemory(cwd);
	let branchTargetId = "";
	for (let index = 0; index < 2; index += 1) {
		sessionManager.appendMessage({ role: "user", content: `Earlier request ${index}`, timestamp: index * 2 });
		const assistantId = sessionManager.appendMessage({
			...fauxAssistantMessage(`Earlier answer ${index}`, { timestamp: index * 2 + 1 }),
			api: model.api,
			provider: model.provider,
			model: model.id,
		});
		if (index === 0) branchTargetId = assistantId;
	}
	const { session } = await createAgentSession({
		cwd,
		model,
		modelRuntime: modelRuntime as never,
		resourceLoader: loader,
		sessionManager,
		settingsManager: SettingsManager.inMemory({
			compaction: { enabled: true, reserveTokens: 1_000, keepRecentTokens: 1 },
		}),
	});
	await session.bindExtensions({});
	try {
		await session.prompt("Continue normally.");
		await new Promise((resolve) => setImmediate(resolve));
		expect(calls[0]).toMatchObject({
			kind: "agent",
			hasPayloadHook: true,
			payload: { tools: [{ type: "web_search" }, { type: "x_search" }] },
		});

		await session.compact();
		expect(calls[1]).toMatchObject({
			kind: "summary",
			hasPayloadHook: false,
			payload: { model: "grok-4.6" },
		});

		const navigation = await session.navigateTree(branchTargetId, { summarize: true });
		expect(navigation.summaryEntry).toBeDefined();
		expect(calls[2]).toMatchObject({
			kind: "summary",
			hasPayloadHook: false,
			payload: { model: "grok-4.6" },
		});
	} finally {
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
});
