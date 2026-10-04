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
 * `replies` is a queue, or a function of the request (and its abort signal) for runs whose order is not fixed. A function may
 * return `"until-aborted"` to hold the request open until its signal aborts, or a promise to hold it until
 * the test releases a reply. With `options.cwd`, the
 * session runs in that existing directory instead, which `dispose` leaves in place.
 */
export async function fauxSession(
	extensionFactories: ExtensionFactory[],
	replies: Reply[] | ((context: Context, signal?: AbortSignal) => Reply | "until-aborted" | Promise<Reply>),
	tools: string[],
	options: { cwd?: string; sessionManager?: SessionManager } = {},
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
			typeof replies === "function"
				? replies(context, options?.signal)
				: (replies.shift() ?? fauxAssistantMessage("done"));
		const events = createAssistantMessageEventStream();
		let settled = false;
		const settle = (reply: Reply) => {
			if (settled) return;
			settled = true;
			if (reply.stopReason === "aborted") events.push({ type: "error", reason: "aborted", error: reply });
			else events.push({ type: "done", reason: reply.stopReason === "toolUse" ? "toolUse" : "stop", message: reply });
			events.end(reply);
		};
		// Like a real provider, an aborted request ends as aborted, whatever reply was scripted. A run
		// aborted between requests (say, from a tool hook or turn ceiling) sends its next request already aborted.
		const abort = () => settle({ ...fauxAssistantMessage(""), stopReason: "aborted", errorMessage: "aborted" });
		if (options?.signal?.aborted) abort();
		else if (message === "until-aborted" || message instanceof Promise)
			options?.signal?.addEventListener("abort", abort, { once: true });
		if (message instanceof Promise) void message.then(settle);
		else if (message !== "until-aborted") settle(message);
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
		sessionManager: options.sessionManager ?? SessionManager.inMemory(cwd),
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
