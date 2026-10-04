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

/**
 * A real AgentSession on a scripted model, with `app.ts` in a temporary cwd. Call `dispose` when done.
 * `replies` is a queue, or a function of the request for runs whose order is not fixed. A function may
 * return `"until-aborted"` to hold the request open until its signal aborts. With `options.cwd`, the
 * session runs in that existing directory instead, which `dispose` leaves in place.
 */
export async function fauxSession(
	extensionFactories: ExtensionFactory[],
	replies: Reply[] | ((context: Context) => Reply | "until-aborted"),
	tools: string[],
	options: { cwd?: string } = {},
) {
	const owned = options.cwd === undefined;
	const cwd = options.cwd ?? mkdtempSync(join(tmpdir(), "apple-pi-faux-session-"));
	// The agent directory stays out of a supplied cwd, which may be a repository under test.
	const agentDir = owned ? join(cwd, "agent") : mkdtempSync(join(tmpdir(), "apple-pi-faux-agent-"));
	if (owned) {
		mkdirSync(agentDir);
		writeFileSync(join(cwd, "app.ts"), "export const value = 1;\n");
	}
	const requests: Context[] = [];
	const stream = (_model: Model<string>, context: Context, options?: { signal?: AbortSignal }) => {
		requests.push(structuredClone(context));
		const message =
			typeof replies === "function" ? replies(context) : (replies.shift() ?? fauxAssistantMessage("done"));
		const events = createAssistantMessageEventStream();
		if (message === "until-aborted") {
			const abort = () => {
				const error = { ...fauxAssistantMessage(""), stopReason: "aborted" as const, errorMessage: "aborted" };
				events.push({ type: "error", reason: "aborted", error });
				events.end(error);
			};
			// A run aborted between requests (say, from a tool hook) sends its next request already aborted.
			if (options?.signal?.aborted) abort();
			else options?.signal?.addEventListener("abort", abort);
			return events;
		}
		events.push({ type: "done", reason: message.stopReason === "toolUse" ? "toolUse" : "stop", message });
		events.end(message);
		return events;
	};
	const { modelRuntime } = fauxModelBackend(model);
	const loader = new DefaultResourceLoader({
		cwd,
		agentDir,
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
		rmSync(owned ? cwd : agentDir, { recursive: true, force: true });
	};
	return { cwd, session, requests, customMessages, dispose };
}
