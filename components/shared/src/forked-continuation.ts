import { AsyncLocalStorage } from "node:async_hooks";
import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import { AgentSession, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { ASK_USER_QUESTION_TOOL_NAME } from "../../ask-user-question/src/types.js";

const FORK_FRAME =
	"You are a headless fork of this conversation. No user is present, and your messages stay in the fork. When you finish, reply with one line for the main conversation: what you did and how you checked it, or that nothing needed to change.";

// Shared through globalThis so every module copy (reloads, tests, child loaders) sees one scope and one capture.
const SCOPE_KEY = Symbol.for("apple-pi.forked-continuation.scope");
const SESSIONS_KEY = Symbol.for("apple-pi.forked-continuation.sessions");
const globalScope = globalThis as Record<PropertyKey, unknown>;
globalScope[SCOPE_KEY] ??= new AsyncLocalStorage<boolean>();
const forkScope = globalScope[SCOPE_KEY] as AsyncLocalStorage<boolean>;

/** True while a tool runs for a fork, so trackers of the main run can ignore it. */
export function inForkedContinuation(): boolean {
	return forkScope.getStore() === true;
}

/**
 * Pi gives extensions no handle on their AgentSession. Remember each session
 * by its session manager, which is the object extension contexts expose.
 */
function liveSessions(): WeakMap<object, AgentSession> {
	const prototype = AgentSession.prototype as AgentSession & Record<PropertyKey, unknown>;
	const existing = prototype[SESSIONS_KEY] as WeakMap<object, AgentSession> | undefined;
	if (existing) return existing;
	const sessions = new WeakMap<object, AgentSession>();
	Object.defineProperty(prototype, SESSIONS_KEY, { value: sessions });
	const prompt = prototype.prompt;
	prototype.prompt = function (this: AgentSession, ...args: Parameters<AgentSession["prompt"]>) {
		sessions.set(this.sessionManager, this);
		return prompt.apply(this, args);
	};
	return sessions;
}

function messageText(message: AgentMessage | undefined): string {
	if (message?.role !== "assistant") return "";
	return message.content
		.flatMap((block) => (block.type === "text" ? [block.text] : []))
		.join("\n")
		.trim();
}

/**
 * Continue an identical copy of the live conversation: same system prompt, tool
 * loadout, model, provider session id, and messages, with `prompt` appended. The
 * session-bound request and turn hooks stay with the parent, so the fork never
 * writes to the parent transcript; its tools still run through the parent's hooks.
 */
async function continueFork(
	session: AgentSession,
	customType: string,
	label: string,
	prompt: string,
	signal: AbortSignal,
) {
	const parent = session.agent;
	const fork = new Agent({
		initialState: {
			systemPrompt: parent.state.systemPrompt,
			model: parent.state.model,
			thinkingLevel: parent.state.thinkingLevel,
			tools: parent.state.tools,
			messages: session.sessionManager.buildSessionProjection().messages,
		},
		convertToLlm: parent.convertToLlm,
		transformContext: parent.transformContext,
		streamFn: parent.streamFunction,
		getApiKey: parent.getApiKey,
		onPayload: parent.onPayload,
		onResponse: parent.onResponse,
		onProviderStreamEvent: parent.onProviderStreamEvent,
		beforeToolCall: async (context, toolSignal) =>
			context.toolCall.name === ASK_USER_QUESTION_TOOL_NAME
				? {
						block: true,
						reason: "No user is present in a headless fork. Decide, or name the open question in your reply.",
					}
				: parent.beforeToolCall?.(context, toolSignal),
		afterToolCall: parent.afterToolCall,
		sessionId: parent.sessionId,
		thinkingBudgets: parent.thinkingBudgets,
		transport: parent.transport,
		maxRetryDelayMs: parent.maxRetryDelayMs,
		toolExecution: parent.toolExecution,
	});
	const abort = () => fork.abort();
	signal.addEventListener("abort", abort, { once: true });
	const unsubscribe = fork.subscribe((event) => {
		if (event.type !== "message_end" || event.message.role !== "assistant") return;
		const { provider, responseModel, model, usage } = event.message;
		session.sessionManager.appendUsage("forked_continuation", provider, responseModel ?? model, usage, label);
	});
	try {
		const message: AgentMessage = {
			role: "custom",
			customType,
			content: `${prompt}\n\n${FORK_FRAME}`,
			display: false,
			timestamp: Date.now(),
		};
		await forkScope.run(true, () => fork.prompt(message));
	} finally {
		unsubscribe();
		signal.removeEventListener("abort", abort);
	}
	const last = fork.state.messages.at(-1);
	if (last?.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted"))
		throw new Error(last.errorMessage ?? last.stopReason);
	return messageText(last) || "The fork finished without a reply.";
}

/**
 * Register a passive continuation that runs in a headless fork and returns one
 * message. The message joins the parent's context without starting or steering a
 * turn: at once when idle, or at the end of the current turn while one streams.
 */
export function registerForkedContinuation(
	pi: ExtensionAPI,
	customType: string,
	label: string,
): (ctx: ExtensionContext, prompt: string) => void {
	const sessions = liveSessions();
	const running = new Set<AbortController>();
	const cancelAll = (_event: unknown, ctx: ExtensionContext) => {
		for (const controller of running) controller.abort();
		running.clear();
		ctx.ui.setStatus(customType, undefined);
	};
	pi.on("session_start", cancelAll);
	pi.on("session_tree", cancelAll);
	pi.on("session_shutdown", cancelAll);

	pi.registerMessageRenderer(customType, (message, { expanded }, theme) => {
		const text =
			typeof message.content === "string"
				? message.content
				: message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
		const shown = theme.fg("muted", `↳ ${expanded ? text : (text.split("\n")[0] ?? "")}`);
		return {
			render: (width: number) => (expanded ? wrapTextWithAnsi(shown, width) : [truncateToWidth(shown, width)]),
			invalidate: () => {},
		};
	});

	return (ctx, prompt) => {
		const session = sessions.get(ctx.sessionManager);
		if (!session) {
			ctx.ui.notify(`${label} skipped: the live session is not available.`, "warning");
			return;
		}
		const controller = new AbortController();
		running.add(controller);
		ctx.ui.setStatus(customType, "reflecting…");
		continueFork(session, customType, label, prompt, controller.signal)
			.then(
				(reply) => {
					if (controller.signal.aborted) return;
					pi.sendMessage({ customType, content: `${label}: ${reply}`, display: true }, { triggerTurn: false });
				},
				(error: unknown) => {
					if (controller.signal.aborted) return;
					ctx.ui.notify(`${label} failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
				},
			)
			.finally(() => {
				if (!running.delete(controller)) return;
				if (running.size === 0) ctx.ui.setStatus(customType, undefined);
			});
	};
}
