import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { streamSimple } from "@earendil-works/pi-ai/compat";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ProviderConfig,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";

it("compacts and retries the same run without sending the oversized continuation upstream", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "apple-pi-auto-compact-"));
	try {
		mkdirSync(join(cwd, ".pi"));
		mkdirSync(join(cwd, "agent"));
		writeFileSync(
			join(cwd, ".pi", "settings.json"),
			JSON.stringify({
				compaction: { enabled: true, reserveTokens: 999, keepRecentTokens: 1 },
				pair: { compactAfterTokens: 1 },
			}),
		);
		const callsPath = join(cwd, "provider-calls.txt");
		const providerPath = join(cwd, "test-provider.ts");
		writeFileSync(
			providerPath,
			`import { appendFileSync } from "node:fs";
import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
	registerApiProvider,
} from "@earendil-works/pi-ai/compat";

const core = createFauxCore({
	api: "test-overflow-api",
	provider: "guard-integration",
	models: [{ id: "guard-model", contextWindow: 1000 }],
});
core.setResponses([
	fauxAssistantMessage(fauxToolCall("read", { path: "package.json" }, { id: "tool-1" }), {
		stopReason: "toolUse",
	}),
	fauxAssistantMessage("completed after compaction"),
]);
const guardedUpstream = (...args) => {
	appendFileSync(${JSON.stringify(callsPath)}, "call\\n");
	return core.streamSimple(...args);
};
registerApiProvider(
	{ api: core.api, stream: guardedUpstream, streamSimple: guardedUpstream },
	"apple-pi-auto-compact-test-provider",
);

export default function (pi) {
	pi.registerProvider("guard-integration", { api: core.api, streamSimple: guardedUpstream });
}
`,
		);
		const compactorPath = join(cwd, "test-compactor.ts");
		writeFileSync(
			compactorPath,
			`export default function (pi) {
	pi.on("session_before_compact", (event) => ({
		compaction: {
			summary: "locally compacted history",
			firstKeptEntryId: event.preparation.firstKeptEntryId,
			tokensBefore: event.preparation.tokensBefore,
		},
	}));
}
`,
		);

		const model = {
			id: "guard-model",
			name: "Guard model",
			api: "test-overflow-api",
			provider: "guard-integration",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1_000,
			maxTokens: 1_000,
		} as Model<string>;
		let activeStream = streamSimple;
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
			registerProvider: (_name: string, config: ProviderConfig) => {
				if (config.streamSimple) activeStream = config.streamSimple;
			},
			registerNativeProvider: () => {},
			unregisterProvider: () => {},
			refresh: async () => ({}),
			stream: (...args: Parameters<typeof streamSimple>) => activeStream(...args),
			streamSimple: (...args: Parameters<typeof streamSimple>) => activeStream(...args),
		};
		const modelRegistry = {
			find: () => model,
			getAll: () => [model],
			getAvailable: () => [model],
			hasConfiguredAuth: () => true,
			isUsingOAuth: () => false,
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "faux", headers: {} }),
			registerProvider: modelRuntime.registerProvider,
			unregisterProvider: () => {},
			runtime: modelRuntime,
		};
		const loader = new DefaultResourceLoader({
			cwd,
			agentDir: join(cwd, "agent"),
			additionalExtensionPaths: [providerPath, join(process.cwd(), "extensions", "auto-compact.ts"), compactorPath],
			noSkills: true,
			noPromptTemplates: true,
			noThemes: true,
			noContextFiles: true,
			systemPromptOverride: () => "test",
			appendSystemPromptOverride: () => [],
		});
		await loader.reload();
		const { session } = await createAgentSession({
			cwd,
			model,
			modelRegistry: modelRegistry as never,
			modelRuntime: modelRuntime as never,
			resourceLoader: loader,
			sessionManager: SessionManager.inMemory(cwd),
			settingsManager: SettingsManager.inMemory({
				compaction: { enabled: true, reserveTokens: 999, keepRecentTokens: 1 },
				retry: { enabled: false },
			}),
		});
		await session.bindExtensions({});
		session.setActiveToolsByName(["read"]);
		const events: unknown[] = [];
		session.subscribe((event) => events.push(JSON.parse(JSON.stringify(event))));

		await session.prompt("Read the manifest and finish.");

		expect(readFileSync(callsPath, "utf8").trim().split("\n")).toHaveLength(2);
		expect(events).not.toContainEqual(
			expect.objectContaining({
				type: "message_end",
				message: expect.objectContaining({ stopReason: "error" }),
			}),
		);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "compaction_end", reason: "overflow", willRetry: true, aborted: false }),
		);
		expect(JSON.stringify(session.messages.at(-1))).toContain("completed after compaction");
		session.dispose();
	} finally {
		rmSync(cwd, { recursive: true, force: true });
	}
});
