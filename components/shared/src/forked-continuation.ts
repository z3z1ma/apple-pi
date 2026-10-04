import { mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { AgentSession, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { ASK_USER_QUESTION_TOOL_NAME } from "../../ask-user-question/src/types.js";
import { type ForkWorktree, runInFork } from "./fork-context.js";
import { canonical, within } from "./real-path.js";

const FORK_FRAME =
	"You are a headless fork of this conversation. No user is present, and your messages stay in the fork. When you finish, reply with one line for the main conversation: what you did and how you checked it, or that nothing needed to change.";
const NO_USER = "No user is present in a headless fork. Decide, or name the open question in your reply.";
const BLOCKED = "This tool is not available in this fork.";
const ISOLATED = "Branch search isolates this attempt to its own copy of the repository.";
const NO_BACKGROUND = "Background commands are not available inside a branch search attempt.";

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
	/** Tool consumers return usage to their caller instead of recording it in the parent. */
	recordUsage?: boolean;
	worktree?: ForkWorktree;
	blockedTools?: ReadonlySet<string>;
	/** Called with each assistant reply's usage as it ends, so a caller can enforce a token limit. */
	onUsage?: (usage: Usage) => void;
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

/** Start remembering sessions as they prompt; call while installing, so `liveSession` finds the session later. */
export function trackLiveSessions(): void {
	liveSessions();
}

/** Render a passive message as its first line, collapsed, and its whole text, expanded. */
function registerPassiveMessageRenderer(pi: ExtensionAPI, customType: string): void {
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
}

/** Writes stay in the worktree or the fork's private temporary directory (spec I5). */
function writesOutside(path: string, { root, tmp }: ForkWorktree): boolean {
	let target: string;
	try {
		target = canonical(path);
	} catch {
		// A path that cannot be resolved cannot be shown to stay in the worktree.
		return true;
	}
	return !within(target, canonical(root)) && !within(target, canonical(tmp));
}

function remapPath(path: string, { root, parentRoot, tmp }: ForkWorktree, cwd: string): string {
	if (!isAbsolute(path)) return resolve(cwd, path);
	if (within(path, root) || within(path, tmp)) return path;
	return within(path, parentRoot) ? join(root, relative(parentRoot, path)) : path;
}

function forkDirectory(parentCwd: string, { root, parentRoot }: ForkWorktree): string {
	const [cwd, repository] = [canonical(parentCwd), canonical(parentRoot)];
	return within(cwd, repository) ? join(root, relative(repository, cwd)) : root;
}

function remapCommand(command: string, { root, parentRoot, tmp }: ForkWorktree): string {
	if (!parentRoot) return command;
	const parentPath = new RegExp(`${parentRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w.-])`, "g");
	// The worktree and the temporary directory may live under the parent root (in its git
	// directory), so leave their own paths alone.
	const keep = (text: string, kept: string[]): string => {
		const [first, ...rest] = kept;
		if (first === undefined) return text.replace(parentPath, root);
		return text
			.split(first)
			.map((part) => keep(part, rest))
			.join(first);
	};
	return keep(command, [root, tmp]);
}

/** Point a tool call at the worktree in place; return a refusal when it would write outside it. */
function isolate(tool: string, args: Record<string, unknown>, worktree: ForkWorktree, cwd: string): string | undefined {
	// A managed background task would outlive the attempt and its worktree.
	if (tool === "bash" && args.run_in_background) return NO_BACKGROUND;
	if (tool === "bash" && typeof args.command === "string") {
		args.command = remapCommand(args.command, worktree);
		return undefined;
	}
	if (!PATH_TOOLS.has(tool)) return undefined;
	if (typeof args.path !== "string") {
		if (SEARCH_TOOLS.has(tool)) args.path = cwd;
		return undefined;
	}
	args.path = remapPath(args.path, worktree, cwd);
	const path = args.path as string;
	if (WRITE_TOOLS.has(tool) && writesOutside(path, worktree)) return ISOLATED;
	return undefined;
}

function groupAlive(pgid: number): boolean {
	try {
		process.kill(-pgid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Kill each process group and wait, up to `waitMs`, until none of its members exists, so a
 * caller that runs next (branch scoring) cannot be watched by a process the fork left behind.
 * A group that outlives the wait fails the fork's result rather than letting the caller go on.
 * A process that left its group (setsid) escapes; branch search accepts that residual risk.
 */
async function killProcessGroups(groups: Iterable<number>, waitMs = 2000): Promise<void> {
	const pending = [...groups];
	for (const pgid of pending) {
		try {
			process.kill(-pgid, "SIGKILL");
		} catch {
			// The group already exited.
		}
	}
	const deadline = Date.now() + waitMs;
	while (pending.some(groupAlive) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 10));
	const alive = pending.filter(groupAlive);
	if (alive.length > 0)
		throw new Error(`Processes of the fork survived SIGKILL in process groups ${alive.join(", ")}.`);
}

/**
 * Continue an identical copy of a conversation: same system prompt, tool loadout,
 * model, and provider session id, starting from `messages` with `append` added.
 * The session-bound request and turn hooks stay with the parent, so the fork never
 * writes to the parent transcript; its tools still run through the parent's hooks.
 * With a worktree, the fork's own tool hook points paths and shell commands at it
 * before those hooks run, and the shell runs there with the fork's private temporary
 * directory; every process the shell started is killed, and that directory deleted,
 * before the result resolves.
 */
export function startFork(session: AgentSession, request: ForkRequest): ForkHandle {
	const parent = session.agent;
	const { worktree, blockedTools } = request;
	// The fork works in the worktree's copy of the directory the parent session runs in.
	const cwd = worktree && forkDirectory(session.sessionManager.getCwd(), worktree);
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
			const refusal = worktree && isolate(tool, context.args as Record<string, unknown>, worktree, cwd as string);
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
		request.onUsage?.(event.message.usage);
		if (request.recordUsage !== false)
			session.sessionManager.appendUsage(
				"forked_continuation",
				provider,
				responseModel ?? model,
				event.message.usage,
				request.label,
			);
	});
	const processGroups = worktree && new Set<number>();
	if (worktree) mkdirSync(worktree.tmp, { recursive: true, mode: 0o700 });
	const result = runInFork({ cwd, processGroups, tmp: worktree?.tmp }, () => fork.prompt(request.append))
		.finally(async () => {
			unsubscribe();
			if (!worktree) return;
			// Nothing may write the temporary directory once it is gone, so the processes go first.
			try {
				await killProcessGroups(processGroups as Set<number>);
			} finally {
				rmSync(worktree.tmp, { recursive: true, force: true });
			}
		})
		.then(() => ({ messages: fork.state.messages, usage }));
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

	registerPassiveMessageRenderer(pi, customType);

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
