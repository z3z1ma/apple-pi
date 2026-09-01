import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Model } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ProviderConfig,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { expect, it } from "vitest";

import { AUTO_COMPACT_EXTENSION_PATH } from "../extensions/auto-compact.js";
import { COMPACTION_SAFETY_EXTENSION_PATH } from "../extensions/compaction-safety.js";

type ProviderCall = {
	source: "custom" | "raw";
	kind: "agent" | "summary";
	customTypes: string[];
};

type Scenario = "success" | "failure" | "cancel";

let harnessSequence = 0;

async function createHarness(scenario: Scenario, keepRecentTokens = 7_600, loadOverflowFallback = false) {
	const sequence = ++harnessSequence;
	const model = {
		id: `compaction-model-${sequence}`,
		name: "Compaction model",
		api: `test-compaction-api-${sequence}`,
		provider: `compaction-integration-${sequence}`,
		reasoning: false,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 10_000,
		maxTokens: 1_000,
	} as Model<string>;
	const cwd = mkdtempSync(join(tmpdir(), "apple-pi-native-compaction-"));
	mkdirSync(join(cwd, ".pi"));
	mkdirSync(join(cwd, "agent"));
	writeFileSync(
		join(cwd, ".pi", "settings.json"),
		JSON.stringify({ compaction: { enabled: true, reserveTokens: 5_000, keepRecentTokens } }),
	);
	writeFileSync(join(cwd, "package.json"), `${"x".repeat(30_000)}\n`);
	const callsPath = join(cwd, "provider-calls.jsonl");
	const providerPath = join(cwd, "provider.ts");
	writeFileSync(
		providerPath,
		`import { appendFileSync } from "node:fs";
import {
	createAssistantMessageEventStream,
	fauxAssistantMessage,
	fauxToolCall,
	registerApiProvider,
} from "@earendil-works/pi-ai/compat";

const scenario = ${JSON.stringify(scenario)};
let mainCallIndex = 0;

function response(message) {
	const stream = createAssistantMessageEventStream();
	stream.push({ type: "done", reason: message.stopReason, message });
	stream.end(message);
	return stream;
}

function record(source, context) {
	const kind = context.tools === undefined ? "summary" : "agent";
	const customTypes = context.messages
		.filter((message) => message.role === "custom")
		.map((message) => message.customType);
	appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({ source, kind, customTypes }) + "\\n");
	return kind;
}

// Deliberately ignores options.signal: the extension must stop dispatch before
// this callback, not rely on cooperative provider cancellation.
const customStream = (_model, context) => {
	const kind = record("custom", context);
	if (kind === "summary") {
		return response(scenario === "failure"
			? fauxAssistantMessage("", { stopReason: "error", errorMessage: "summary provider failed" })
			: fauxAssistantMessage("compacted history"));
	}
	const message = mainCallIndex === 0
		? fauxAssistantMessage(fauxToolCall("read", { path: "package.json" }, { id: "tool-1" }), {
			stopReason: "toolUse",
		})
		: fauxAssistantMessage("completed after compaction");
	mainCallIndex += 1;
	return response(message);
};

const rawStream = (_model, context) => {
	record("raw", context);
	return response(fauxAssistantMessage("raw API provider must remain bypassed"));
};

registerApiProvider(
	{ api: ${JSON.stringify(model.api)}, stream: rawStream, streamSimple: rawStream },
	${JSON.stringify(`apple-pi-compaction-test-provider-${sequence}`)},
);

export default function (pi) {
	pi.registerProvider(${JSON.stringify(model.provider)}, {
		api: ${JSON.stringify(model.api)},
		streamSimple: customStream,
	});
}
`,
	);
	const scenarioExtension = join(cwd, "scenario.ts");
	writeFileSync(
		scenarioExtension,
		scenario === "success"
			? `export default function (pi) {
	pi.on("session_before_compact", (event) => ({
		compaction: {
			summary: "locally compacted history",
			firstKeptEntryId: event.preparation.firstKeptEntryId,
			tokensBefore: event.preparation.tokensBefore,
		},
	}));
}
`
			: scenario === "cancel"
				? `export default function (pi) {
	pi.on("session_before_compact", () => ({ cancel: true }));
}
`
				: `export default function () {}
`,
	);

	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: join(cwd, "agent"),
		additionalExtensionPaths: [
			loadOverflowFallback ? AUTO_COMPACT_EXTENSION_PATH : COMPACTION_SAFETY_EXTENSION_PATH,
			providerPath,
			scenarioExtension,
		],
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
		systemPromptOverride: () => "test",
		appendSystemPromptOverride: () => [],
	});
	await loader.reload();
	const extensions = loader.getExtensions();
	expect(extensions.errors).toEqual([]);
	const registration = extensions.runtime.pendingProviderRegistrations.find(({ name }) => name === model.provider);
	if (!registration?.config.streamSimple) throw new Error("test provider did not register its simple stream");
	let activeStream = registration.config.streamSimple;
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
		stream: (...args: Parameters<typeof activeStream>) => activeStream(...args),
		streamSimple: (...args: Parameters<typeof activeStream>) => activeStream(...args),
	};
	const sessionManager = SessionManager.create(cwd, join(cwd, "sessions"));
	for (let index = 0; index < 2; index += 1) {
		sessionManager.appendMessage({
			role: "user",
			content: `Earlier request ${index}: ${"u".repeat(500)}`,
			timestamp: index * 2,
		});
		sessionManager.appendMessage({
			...fauxAssistantMessage(`Earlier answer ${index}: ${"a".repeat(500)}`, { timestamp: index * 2 + 1 }),
			api: model.api,
			provider: model.provider,
			model: model.id,
		});
	}
	const bindSession = async (manager: SessionManager) => {
		const { session } = await createAgentSession({
			cwd,
			model,
			modelRuntime: modelRuntime as never,
			resourceLoader: loader,
			sessionManager: manager,
			settingsManager: SettingsManager.inMemory(
				{
					compaction: { enabled: true, reserveTokens: 5_000, keepRecentTokens },
					retry: { enabled: false },
				},
				{ projectTrusted: true },
			),
		});
		await session.bindExtensions({});
		expect(session.extensionRunner.hasHandlers("session_compact_failed")).toBe(true);
		session.setActiveToolsByName(["read"]);
		return session;
	};
	const session = await bindSession(sessionManager);
	return {
		cwd,
		readCalls: () =>
			readFileSync(callsPath, "utf8")
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line) as ProviderCall),
		reload: async () => {
			const file = sessionManager.getSessionFile();
			if (!file) throw new Error("test session was not persisted");
			return bindSession(SessionManager.open(file));
		},
		session,
		sessionManager,
	};
}

it("uses native threshold compaction before the same-run post-tool provider request", async () => {
	const { cwd, readCalls, session, sessionManager } = await createHarness("success");
	const events: unknown[] = [];
	session.subscribe((event) => events.push(JSON.parse(JSON.stringify(event))));
	try {
		await session.prompt("Read the manifest and finish.");

		expect(readCalls()).toEqual([
			{ source: "custom", kind: "agent", customTypes: [] },
			{ source: "custom", kind: "agent", customTypes: [] },
		]);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "compaction_end", reason: "threshold", willRetry: false, aborted: false }),
		);
		expect(JSON.stringify(session.messages.at(-1))).toContain("completed after compaction");
		expect(
			sessionManager
				.getBranch()
				.some((entry) => entry.type === "custom_message" && entry.customType === "apple-pi.compaction-cut-point"),
		).toBe(false);
	} finally {
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
});

it("aborts the same-run continuation when native threshold compaction fails", async () => {
	const { cwd, readCalls, session } = await createHarness("failure");
	const events: unknown[] = [];
	session.subscribe((event) => events.push(JSON.parse(JSON.stringify(event))));
	try {
		await session.prompt("Read the manifest and finish.");

		expect(readCalls()).toEqual([
			{ source: "custom", kind: "agent", customTypes: [] },
			{ source: "custom", kind: "summary", customTypes: [] },
		]);
		expect(events).toContainEqual(
			expect.objectContaining({
				type: "compaction_end",
				reason: "threshold",
				aborted: false,
				willRetry: false,
				errorMessage: expect.stringContaining("summary provider failed"),
			}),
		);
		expect(JSON.stringify(session.messages)).not.toContain("completed after compaction");
	} finally {
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
});

it("aborts the same-run continuation when native threshold compaction is cancelled", async () => {
	const { cwd, readCalls, session } = await createHarness("cancel");
	const events: unknown[] = [];
	session.subscribe((event) => events.push(JSON.parse(JSON.stringify(event))));
	try {
		await session.prompt("Read the manifest and finish.");

		expect(readCalls()).toEqual([{ source: "custom", kind: "agent", customTypes: [] }]);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "compaction_end", reason: "threshold", aborted: true, willRetry: false }),
		);
	} finally {
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
});

it("adds a hidden cut point when a tool result exceeds Pi's keep-recent budget", async () => {
	const { cwd, readCalls, reload, session, sessionManager } = await createHarness("success", 1, true);
	const events: unknown[] = [];
	session.subscribe((event) => events.push(JSON.parse(JSON.stringify(event))));
	let reloaded: Awaited<ReturnType<typeof reload>> | undefined;
	try {
		await session.prompt("Read the manifest and finish.");

		expect(readCalls()).toEqual([
			{ source: "custom", kind: "agent", customTypes: [] },
			{ source: "custom", kind: "agent", customTypes: [] },
		]);
		expect(events).toContainEqual(
			expect.objectContaining({ type: "compaction_end", reason: "threshold", willRetry: false, aborted: false }),
		);
		const branch = sessionManager.getBranch();
		const marker = branch.find(
			(entry) => entry.type === "custom_message" && entry.customType === "apple-pi.compaction-cut-point",
		);
		const compaction = branch.find((entry) => entry.type === "compaction");
		expect(marker).toBeDefined();
		expect(compaction).toMatchObject({ firstKeptEntryId: marker?.id });
		expect(JSON.stringify(session.messages.at(-1))).toContain("completed after compaction");

		session.dispose();
		reloaded = await reload();
		await reloaded.prompt("Continue after reload.");
		expect(readCalls().at(-1)).toEqual({ source: "custom", kind: "agent", customTypes: [] });
	} finally {
		reloaded?.dispose();
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
	}
});
