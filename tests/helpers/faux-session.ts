import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context, Model } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream, fauxAssistantMessage } from "@earendil-works/pi-ai/compat";
import {
	createAgentSession,
	DefaultResourceLoader,
	type ExtensionFactory,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { fauxModelBackend } from "./faux-model.js";

export type Reply = ReturnType<typeof fauxAssistantMessage>;

const model = {
	id: "faux-session-model",
	name: "Faux session model",
	api: "test-faux-session-api",
	provider: "faux-session-provider",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 100_000,
	maxTokens: 10_000,
} as Model<string>;

/** A real AgentSession on a scripted model, with `app.ts` in a temporary cwd. Call `dispose` when done. */
export async function fauxSession(extensionFactories: ExtensionFactory[], replies: Reply[], tools: string[]) {
	const cwd = mkdtempSync(join(tmpdir(), "apple-pi-faux-session-"));
	mkdirSync(join(cwd, "agent"));
	writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	const requests: Context[] = [];
	const stream = (_model: Model<string>, context: Context) => {
		requests.push(structuredClone(context));
		const message = replies.shift() ?? fauxAssistantMessage("done");
		const events = createAssistantMessageEventStream();
		events.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
		events.end(message);
		return events;
	};
	const { modelRuntime } = fauxModelBackend(model);
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir: join(cwd, "agent"),
		extensionFactories,
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
		modelRuntime: { ...modelRuntime, stream, streamSimple: stream } as never,
		resourceLoader: loader,
		sessionManager: SessionManager.inMemory(cwd),
		settingsManager: SettingsManager.inMemory({ compaction: { enabled: false } }),
	});
	await session.bindExtensions({});
	session.setActiveToolsByName(tools);
	const customMessages = (customType: string) =>
		session.messages.filter((message) => message.role === "custom" && message.customType === customType);
	const dispose = () => {
		session.dispose();
		rmSync(cwd, { recursive: true, force: true });
	};
	return { cwd, session, requests, customMessages, dispose };
}
