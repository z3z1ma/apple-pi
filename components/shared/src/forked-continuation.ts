import { tmpdir } from "node:os";
import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { AgentSession, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { ASK_USER_QUESTION_TOOL_NAME } from "../../ask-user-question/src/types.js";
import { type ForkWorktree, runInFork } from "./fork-context.js";

const FORK_FRAME =
	"You are a headless fork of this conversation. No user is present, and your messages stay in the fork. When you finish, reply with one line for the main conversation: what you did and how you checked it, or that nothing needed to change.";
const NO_USER = "No user is present in a headless fork. Decide, or name the open question in your reply.";
const BLOCKED = "This tool is not available inside a branch search attempt.";
const ISOLATED = "Branch search isolates this attempt to its own copy of the repository.";

const PATH_TOOLS = new Set(["read", "write", "edit", "ls", "grep", "find"]);
const WRITE_TOOLS = new Set(["write", "edit"]);
const SEARCH_TOOLS = new Set(["ls", "grep", "find"]);

const SESSIONS_KEY = Symbol.for("apple-pi.forked-continuation.sessions");

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

export interface ForkRequest {
	/** The conversation the fork starts from. */
	messages: AgentMessage[];
	/** The one message appended after it: a prompt, or the result of a pending tool call. */
	append: AgentMessage;
	/** Names the fork's usage entries in the parent session. */
	label: string;
	worktree?: ForkWorktree;
	blockedTools?: ReadonlySet<string>;
}

export interface ForkResult {
	messages: AgentMessage[];
	usage: Usage[];
}

export interface ForkHandle {
	result: Promise<ForkResult>;
	abort(): void;
}

export function liveSession(ctx: ExtensionContext): AgentSession | undefined {
	return liveSessions().get(ctx.sessionManager);
}

function within(path: string, dir: string): boolean {
	const rel = relative(dir, path);
	return rel === "" || (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

/** The path with symlinks resolved; a path that does not exist yet resolves through its nearest existing ancestor. */
function canonical(path: string): string {
	const missing: string[] = [];
	for (let dir = path; ; dir = dirname(dir)) {
		try {
			return join(realpathSync(dir), ...missing.reverse());
		} catch {
			if (dirname(dir) === dir) return path;
			missing.push(basename(dir));
		}
	}
}

/** Writes stay in the worktree or the temp directory, and never reach the parent workspace (spec I5). */
function writesOutside(path: string, { root, parentRoot }: ForkWorktree): boolean {
	const target = canonical(path);
	if (within(target, canonical(root))) return false;
	return within(target, canonical(parentRoot)) || !within(target, canonical(tmpdir()));
}

function remapPath(path: string, { root, parentRoot }: ForkWorktree): string {
	if (!isAbsolute(path)) return resolve(root, path);
	if (within(path, root) || !within(path, parentRoot)) return path;
	return join(root, relative(parentRoot, path));
}

function remapCommand(command: string, { root, parentRoot }: ForkWorktree): string {
	const escaped = parentRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const parentPath = new RegExp(`${escaped}(?![\\w.-])`, "g");
	// The worktree may live under the parent root (in its git directory), so leave its own paths alone.
	return command
		.split(root)
		.map((part) => part.replace(parentPath, root))
		.join(root);
}

/** Point a tool call at the worktree in place; return a refusal when it would write outside it. */
function isolate(tool: string, args: Record<string, unknown>, worktree: ForkWorktree): string | undefined {
	if (tool === "bash" && typeof args.command === "string") {
		args.command = remapCommand(args.command, worktree);
		return undefined;
	}
	if (!PATH_TOOLS.has(tool)) return undefined;
	if (typeof args.path !== "string") {
		if (SEARCH_TOOLS.has(tool)) args.path = worktree.root;
		return undefined;
	}
	args.path = remapPath(args.path, worktree);
	const path = args.path as string;
	if (WRITE_TOOLS.has(tool) && writesOutside(path, worktree)) return ISOLATED;
	return undefined;
}

/**
 * Continue an identical copy of a conversation: same system prompt, tool loadout,
 * model, and provider session id, starting from `messages` with `append` added.
 * The session-bound request and turn hooks stay with the parent, so the fork never
 * writes to the parent transcript; its tools still run through the parent's hooks.
 * With a worktree, the fork's own tool hook points paths and shell commands at it
 * before those hooks run, and the shell runs there.
 */
export function startFork(session: AgentSession, request: ForkRequest): ForkHandle {
	const parent = session.agent;
	const { worktree, blockedTools } = request;
	const fork = new Agent({
		initialState: {
			systemPrompt: parent.state.systemPrompt,
			model: parent.state.model,
			thinkingLevel: parent.state.thinkingLevel,
			tools: parent.state.tools,
			messages: request.messages,
		},
		convertToLlm: parent.convertToLlm,
		transformContext: parent.transformContext,
		streamFn: parent.streamFunction,
		getApiKey: parent.getApiKey,
		onPayload: parent.onPayload,
		onResponse: parent.onResponse,
		onProviderStreamEvent: parent.onProviderStreamEvent,
		beforeToolCall: async (context, toolSignal) => {
			const tool = context.toolCall.name;
			if (tool === ASK_USER_QUESTION_TOOL_NAME) return { block: true, reason: NO_USER };
			if (blockedTools?.has(tool)) return { block: true, reason: BLOCKED };
			const refusal = worktree && isolate(tool, context.args as Record<string, unknown>, worktree);
			if (refusal) return { block: true, reason: refusal };
			return parent.beforeToolCall?.(context, toolSignal);
		},
		afterToolCall: parent.afterToolCall,
		sessionId: parent.sessionId,
		thinkingBudgets: parent.thinkingBudgets,
		transport: parent.transport,
		maxRetryDelayMs: parent.maxRetryDelayMs,
		toolExecution: parent.toolExecution,
	});
	const usage: Usage[] = [];
	const unsubscribe = fork.subscribe((event) => {
		if (event.type !== "message_end" || event.message.role !== "assistant") return;
		const { provider, responseModel, model } = event.message;
		usage.push(event.message.usage);
		session.sessionManager.appendUsage(
			"forked_continuation",
			provider,
			responseModel ?? model,
			event.message.usage,
			request.label,
		);
	});
	const result = runInFork({ worktree }, () => fork.prompt(request.append))
		.then(() => ({ messages: fork.state.messages, usage }))
		.finally(unsubscribe);
	return { result, abort: () => fork.abort() };
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
	liveSessions();
	const running = new Set<ForkHandle>();
	const cancelAll = (_event: unknown, ctx: ExtensionContext) => {
		for (const fork of running) fork.abort();
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
		const session = liveSession(ctx);
		if (!session) {
			ctx.ui.notify(`${label} skipped: the live session is not available.`, "warning");
			return;
		}
		const fork = startFork(session, {
			messages: session.sessionManager.buildSessionProjection().messages,
			append: {
				role: "custom",
				customType,
				content: `${prompt}\n\n${FORK_FRAME}`,
				display: false,
				timestamp: Date.now(),
			},
			label,
		});
		running.add(fork);
		ctx.ui.setStatus(customType, "reflecting…");
		fork.result
			.then(({ messages }) => {
				const last = messages.at(-1);
				if (last?.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted"))
					throw new Error(last.errorMessage ?? last.stopReason);
				return messageText(last) || "The fork finished without a reply.";
			})
			.then(
				(reply) => {
					if (!running.has(fork)) return;
					pi.sendMessage({ customType, content: `${label}: ${reply}`, display: true }, { triggerTurn: false });
				},
				(error: unknown) => {
					if (!running.has(fork)) return;
					ctx.ui.notify(`${label} failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
				},
			)
			.finally(() => {
				if (!running.delete(fork)) return;
				if (running.size === 0) ctx.ui.setStatus(customType, undefined);
			});
	};
}
