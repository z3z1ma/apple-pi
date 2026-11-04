import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Agent, type AgentMessage } from "@earendil-works/pi-agent-core";
import type { Usage } from "@earendil-works/pi-ai";
import { AgentSession, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";

import { ASK_USER_QUESTION_TOOL_NAME } from "../../ask-user-question/src/types.js";
import { renderInline } from "./compact-custom-message.js";
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

function liveSessions(): WeakMap<object, AgentSession> {
	const prototype = AgentSession.prototype as AgentSession & Record<PropertyKey, unknown>;
	const existing = prototype[SESSIONS_KEY] as WeakMap<object, AgentSession> | undefined;
	if (existing) return existing;
	const sessions = new WeakMap<object, AgentSession>();
	Object.defineProperty(prototype, SESSIONS_KEY, { value: sessions });
	const bindExtensions = prototype.bindExtensions;
	prototype.bindExtensions = function (this: AgentSession, ...args: Parameters<AgentSession["bindExtensions"]>) {
		sessions.set(this.sessionManager, this);
		return bindExtensions.apply(this, args);
	};
	const prompt = prototype.prompt;
	prototype.prompt = function (this: AgentSession, ...args: Parameters<AgentSession["prompt"]>) {
		sessions.set(this.sessionManager, this);
		return prompt.apply(this, args);
	};
	const sendCustomMessage = prototype.sendCustomMessage;
	prototype.sendCustomMessage = function (this: AgentSession, ...args: Parameters<AgentSession["sendCustomMessage"]>) {
		sessions.set(this.sessionManager, this);
		return sendCustomMessage.apply(this, args);
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
	messages: AgentMessage[];
	append: AgentMessage;
	label: string;
	recordUsage?: boolean;
	worktree?: ForkWorktree;
	blockedTools?: ReadonlySet<string>;
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

export function trackLiveSessions(): void {
	liveSessions();
}

export function closePendingCalls(messages: AgentMessage[], note: string): void {
	const pending = new Map<string, { id: string; name: string }>();
	for (const message of messages) {
		if (message.role === "assistant") {
			for (const block of message.content) if (block.type === "toolCall") pending.set(block.id, block);
		} else if (message.role === "toolResult") pending.delete(message.toolCallId);
	}
	for (const call of pending.values())
		messages.push({
			role: "toolResult",
			toolCallId: call.id,
			toolName: call.name,
			content: [{ type: "text", text: note }],
			isError: true,
			timestamp: Date.now(),
		});
}

function registerPassiveMessageRenderer(pi: ExtensionAPI, customType: string): void {
	let session: AgentSession | undefined;
	pi.on("session_start", (_event, ctx) => {
		session = liveSession(ctx);
	});
	pi.on("session_shutdown", () => {
		session = undefined;
	});
	renderInline(customType);
	pi.registerMessageRenderer(customType, (message, _options, theme) => {
		const text =
			typeof message.content === "string"
				? message.content
				: message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("\n");
		return {
			render(width: number) {
				const expanded = session !== undefined && !session.settingsManager.getHideThinkingBlock();
				const shown = theme.fg("muted", `\u21b3 ${expanded ? text : (text.split("\n")[0] ?? "")}`);
				return expanded ? wrapTextWithAnsi(shown, width) : [truncateToWidth(shown, width)];
			},
			invalidate: () => {},
		};
	});
}

function writesOutside(path: string, { root, tmp }: ForkWorktree): boolean {
	let target: string;
	try {
		target = canonical(path);
	} catch {
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

function isolate(tool: string, args: Record<string, unknown>, worktree: ForkWorktree, cwd: string): string | undefined {
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

async function killProcessGroups(groups: Iterable<number>, waitMs = 2000): Promise<void> {
	const pending = [...groups];
	for (const pgid of pending) {
		try {
			process.kill(-pgid, "SIGKILL");
		} catch {}
	}
	const deadline = Date.now() + waitMs;
	while (pending.some(groupAlive) && Date.now() < deadline) await new Promise((done) => setTimeout(done, 10));
	const alive = pending.filter(groupAlive);
	if (alive.length > 0)
		throw new Error(`Processes of the fork survived SIGKILL in process groups ${alive.join(", ")}.`);
}

export function startFork(session: AgentSession, request: ForkRequest): ForkHandle {
	const parent = session.agent;
	const { worktree, blockedTools } = request;
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
		sessionId: `${parent.sessionId ?? "fork"}:fork:${randomUUID()}`,
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
	const result = runInFork(
		{
			sessionId: session.sessionManager.getSessionId(),
			cwd,
			processGroups,
			tmp: worktree?.tmp,
			messages: () => fork.state.messages,
		},
		() => fork.prompt(request.append),
	)
		.finally(async () => {
			unsubscribe();
			if (!worktree) return;
			try {
				await killProcessGroups(processGroups as Set<number>);
			} finally {
				rmSync(worktree.tmp, { recursive: true, force: true });
			}
		})
		.then(() => ({ messages: fork.state.messages, usage }));
	return { result, abort: () => fork.abort() };
}

export function registerForkedContinuation(
	pi: ExtensionAPI,
	customType: string,
	label: string,
	compose: (reply: string) => string | undefined = (reply) => `${label}: ${reply}`,
): (ctx: ExtensionContext, prompt: string) => Promise<void> {
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
			return Promise.resolve();
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
		return fork.result
			.then(({ messages }) => {
				const last = messages.at(-1);
				if (last?.role === "assistant" && (last.stopReason === "error" || last.stopReason === "aborted"))
					throw new Error(last.errorMessage ?? last.stopReason);
				return messageText(last) || "The fork finished without a reply.";
			})
			.then(
				(reply) => {
					const content = running.has(fork) ? compose(reply) : undefined;
					if (content) pi.sendMessage({ customType, content, display: true }, { triggerTurn: false });
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
