import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context, Model } from "@earendil-works/pi-ai";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxToolCall,
	type ProviderRequestOptions,
} from "@earendil-works/pi-ai/compat";
import {
	createAgentSession,
	DefaultResourceLoader,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";

function responseStream(message: ReturnType<typeof fauxAssistantMessage>) {
	const stream = createAssistantMessageEventStream();
	const reason = message.stopReason === "toolUse" ? "toolUse" : "stop";
	stream.push({ type: "done", reason, message });
	stream.end(message);
	return stream;
}

it("persists triggerTurn false pair advice after the active turn's tool results", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "apple-pi-pair-ordering-"));
	mkdirSync(join(cwd, "agent"));
	writeFileSync(join(cwd, "package.json"), "{}\n");
	const extensionPath = join(cwd, "late-advice.ts");
	writeFileSync(
		extensionPath,
		`export default function (pi) {
	pi.on("tool_execution_start", () => {
		pi.sendMessage(
			{ customType: "pair.advisory", content: "late pair advice", display: true },
			{ deliverAs: "steer", triggerTurn: false },
		);
	});
}
`,
	);
	const model = {
		id: "ordering-model",
		name: "Ordering model",
		api: "test-ordering-api",
		provider: "ordering-provider",
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 100_000,
		maxTokens: 10_000,
	} as Model<string>;
	let callIndex = 0;
	const stream = (_model: Model<string>, _context: Context, _options: ProviderRequestOptions) => {
		const message =
			callIndex === 0
				? fauxAssistantMessage(fauxToolCall("read", { path: "package.json" }, { id: "tool-1" }), {
						stopReason: "toolUse",
					})
				: fauxAssistantMessage("final response after advice");
		callIndex += 1;
		return responseStream(message);
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
		additionalExtensionPaths: [extensionPath],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPromptOverride: () => "test",
		appendSystemPromptOverride: () => [],
	});
	await loader.reload();
	const sessionManager = SessionManager.inMemory(cwd);
	const { session } = await createAgentSession({
		cwd,
		model,
		modelRuntime: modelRuntime as never,
		resourceLoader: loader,
		sessionManager,
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
	});
	await session.bindExtensions({});
	session.setActiveToolsByName(["read"]);
	try {
		await session.prompt("Read the manifest, then continue.");

		const messages = session.messages;
		const toolResultIndex = messages.findIndex((message) => message.role === "toolResult");
		const adviceIndex = messages.findIndex(
			(message) => message.role === "custom" && message.customType === "pair.advisory",
		);
		const finalIndex = messages.findIndex(
			(message) =>
				message.role === "assistant" && JSON.stringify(message.content).includes("final response after advice"),
		);
		expect(toolResultIndex).toBeGreaterThan(-1);
		expect(adviceIndex).toBeGreaterThan(toolResultIndex);
		expect(finalIndex).toBeGreaterThan(adviceIndex);

		const entries = sessionManager.getBranch();
		const toolResultEntry = entries.findIndex(
			(entry) => entry.type === "message" && entry.message.role === "toolResult",
		);
		const adviceEntry = entries.findIndex(
			(entry) => entry.type === "custom_message" && entry.customType === "pair.advisory",
		);
		expect(adviceEntry).toBeGreaterThan(toolResultEntry);
	} finally {
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
});
