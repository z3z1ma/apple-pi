import { execFile, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { LEDGER_LINK_CHANNEL, type LedgerLink } from "../../shared/src/ledger-events.js";
import { childSessionParent, inChildSessionContext } from "../../subagents/src/child-context.js";
import { statePaths } from "./paths.js";
import {
	type BridgeMessage,
	type Command,
	type Facts,
	HEARTBEAT_MS,
	type Hello,
	type IndexRow,
	lineReader,
	type RunState,
	type Tool,
} from "./protocol.js";

const RUNTIME_MAIN = fileURLToPath(new URL("./runtime-main.ts", import.meta.url));
const REGISTER = new URL("./register.mjs", import.meta.url).href;
const RETRY_MS = 250;
const QUESTIONNAIRE_TOOL = "ask_user_question";

/**
 * Start a runtime detached from this session; it keeps running after the session ends. Its output goes to
 * the runtime log, and a failed start is reported through `warn` (exit 0 only means another runtime runs).
 */
function spawnRuntime(warn: (message: string) => void): void {
	const paths = statePaths();
	let log: number;
	try {
		mkdirSync(paths.dir, { recursive: true, mode: 0o700 });
		log = openSync(paths.log, "a", 0o600);
	} catch (error) {
		warn(`Session state: cannot use ${paths.dir}: ${(error as Error).message}`);
		return;
	}
	const child = spawn(process.execPath, ["--import", REGISTER, RUNTIME_MAIN], {
		detached: true,
		stdio: ["ignore", log, log],
		env: process.env,
	});
	closeSync(log);
	child.on("error", (error) => warn(`Session state: cannot start the runtime: ${error.message}`));
	child.on("exit", (code) => {
		if (code) warn(`Session state: the runtime exited with code ${code}; see ${paths.log}`);
	});
	child.unref();
}

/**
 * One session's link to the runtime. It keeps the session's current state and sends it whole on every
 * (re)connect, so nothing depends on messages sent while the runtime was away.
 */
class StateLink {
	private socket?: Socket;
	private connected = false;
	private closed = false;
	private spawned = false;
	private heartbeat?: NodeJS.Timeout;
	private retry?: NodeJS.Timeout;
	readonly hello: Hello;
	/** Every conversation row indexed so far; all are sent again on reconnect, and the runtime ignores repeats. */
	private readonly rows: IndexRow[] = [];
	private readonly warn: (message: string) => void;
	private readonly onCommand: (commandId: string, command: Command) => void;

	constructor(hello: Hello, warn: (message: string) => void, onCommand: (commandId: string, command: Command) => void) {
		this.hello = hello;
		this.warn = warn;
		this.onCommand = onCommand;
		this.connect();
	}

	progress(commandId: string, stage: "delivered" | "applied" | "failed", reason?: string): void {
		this.send({ type: "command_progress", commandId, stage, ...(reason ? { reason } : {}) });
	}

	run(run: RunState): void {
		if (this.hello.run === run) return;
		this.hello.run = run;
		this.send({ type: "run", run });
	}

	/** Merge changed facts into the snapshot and send only what changed. */
	facts(patch: Partial<Facts>): void {
		const changed: Partial<Facts> = {};
		for (const [key, value] of Object.entries(patch) as [keyof Facts, unknown][]) {
			if (JSON.stringify(this.hello.facts[key]) === JSON.stringify(value)) continue;
			(this.hello.facts as unknown as Record<string, unknown>)[key] = value;
			(changed as Record<string, unknown>)[key] = value;
		}
		if (Object.keys(changed).length > 0) this.send({ type: "facts", facts: changed });
	}

	taskLink(bundle: string, taskId: string, via: string): void {
		this.send({ type: "task_link", bundle, taskId, via, at: Date.now() });
	}

	index(rows: IndexRow[]): void {
		if (rows.length === 0) return;
		this.rows.push(...rows);
		this.send({ type: "index", rows });
	}

	toolStart(tool: Tool): void {
		this.hello.tool = tool;
		this.send({ type: "tool_start", tool });
	}

	/** A tool ended; `current` is the tool still running, if any, which the session now shows instead. */
	toolEnd(id: string, name: string, durationMs: number, isError: boolean, current: Tool | undefined): void {
		this.hello.tool = current;
		this.send({ type: "tool_end", id, name, durationMs, isError, current: current ?? null });
	}

	/**
	 * End the link. With a reason, the session ended and the runtime records it. Without one (a reload, or a new
	 * bridge instance taking over), the process lives on and the next bridge resumes the same incarnation.
	 */
	close(reason?: string): void {
		if (this.closed) return;
		if (reason) this.send({ type: "shutdown", reason });
		this.closed = true;
		clearInterval(this.heartbeat);
		clearTimeout(this.retry);
		this.socket?.end();
	}

	private connect(): void {
		if (this.closed) return;
		const socket = createConnection(statePaths().socket);
		this.socket = socket;
		socket.on("connect", () => {
			this.connected = true;
			this.send(this.hello);
			if (this.rows.length > 0) this.send({ type: "index", rows: this.rows });
			this.heartbeat = setInterval(() => this.send({ type: "heartbeat" }), HEARTBEAT_MS);
			this.heartbeat.unref();
		});
		socket.on(
			"data",
			lineReader((line) => {
				let message: { type?: string; commandId?: string; command?: Command };
				try {
					message = JSON.parse(line);
				} catch {
					return;
				}
				if (message.type === "command" && message.commandId && message.command)
					this.onCommand(message.commandId, message.command);
			}),
		);
		socket.on("error", () => {});
		socket.on("close", () => {
			this.connected = false;
			clearInterval(this.heartbeat);
			if (this.closed) return;
			if (!this.spawned) {
				this.spawned = true;
				spawnRuntime(this.warn);
			}
			this.retry = setTimeout(() => this.connect(), RETRY_MS);
			this.retry.unref();
		});
		socket.unref();
	}

	private send(message: BridgeMessage): void {
		if (this.connected && this.socket) this.socket.write(`${JSON.stringify(message)}\n`);
	}
}

/** The argument that says what a tool call does, by the same rule the tmux sidebar has always used. */
const MAIN_ARGS = ["command", "path", "pattern", "query", "description", "task", "name", "code"];
function mainArg(args: unknown): string | undefined {
	if (!args || typeof args !== "object") return undefined;
	for (const key of MAIN_ARGS) {
		const value = (args as Record<string, unknown>)[key];
		if (typeof value === "string" && value.trim()) return value.trim().split("\n")[0];
	}
	return undefined;
}

function modelName(ctx: ExtensionContext): string | null {
	return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null;
}

function contextUsage(ctx: ExtensionContext): Pick<Facts, "contextTokens" | "contextWindow"> {
	const usage = ctx.getContextUsage();
	return { contextTokens: usage?.tokens ?? null, contextWindow: usage?.contextWindow ?? null };
}

/** Cost so far, from every assistant message already in the session (a resumed session has history). */
function sessionCost(ctx: ExtensionContext): number {
	let total = 0;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		total += entry.message.usage?.cost?.total ?? 0;
	}
	return total;
}

/** Option names on Pi's command line; values are left out, since a positional prompt can follow a boolean flag. */
function flagNames(): string[] {
	return process.argv
		.slice(2)
		.filter((arg) => arg.startsWith("--"))
		.map((arg) => arg.slice(2).split("=")[0])
		.sort();
}

/**
 * Extensions are the files that registered tools or extension commands; built-in tools, skills, and prompt
 * templates are not extensions. An extension that registers only hooks is invisible here: Pi lists no extensions.
 */
function config(pi: ExtensionAPI, ctx: ExtensionContext, skills: string[], mcpServers: string[]): Facts["config"] {
	const sources = new Set<string>();
	for (const tool of pi.getAllTools()) {
		const path = tool.sourceInfo?.path;
		if (path && !path.startsWith("builtin:") && !path.startsWith("<")) sources.add(path);
	}
	for (const command of pi.getCommands())
		if (command.source === "extension" && command.sourceInfo?.path) sources.add(command.sourceInfo.path);
	return {
		name: ctx.sessionManager.getSessionName() ?? null,
		flags: flagNames(),
		activeTools: [...pi.getActiveTools()].sort(),
		extensions: [...sources].sort(),
		skills,
		mcpServers,
	};
}

function helloFor(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	skills: string[],
	mcpServers: string[],
	previousSession: Facts["previousSession"],
): Hello {
	const sessions = ctx.sessionManager;
	const child = inChildSessionContext();
	return {
		type: "hello",
		session: {
			id: sessions.getSessionId(),
			kind: child ? "child" : "root",
			...(child ? { spawnedBy: childSessionParent() } : {}),
			file: sessions.getSessionFile(),
			cwd: ctx.cwd,
			name: sessions.getSessionName(),
		},
		process: { pid: process.pid, startedAt: Math.round(Date.now() - process.uptime() * 1000) },
		// A subagent runs in its parent's process and pane; the pane belongs to the parent.
		tmux: child ? undefined : tmuxPane(),
		run: ctx.isIdle() ? "idle" : "thinking",
		facts: {
			model: modelName(ctx),
			thinkingLevel: pi.getThinkingLevel(),
			...contextUsage(ctx),
			cost: sessionCost(ctx),
			prompt: null,
			queue: { steers: 0, followUps: 0, pending: false },
			lastError: null,
			lastAbortAt: null,
			reportsTo: (pi.getFlag("reports-to") as string | undefined) || null,
			parentSessionFile: sessions.getHeader()?.parentSession ?? null,
			previousSession,
			git: null,
			currentTask: null,
			config: config(pi, ctx, skills, mcpServers),
		},
	};
}

/** tmux sets `TMUX` to `<socket>,<server pid>,<session>` and `TMUX_PANE` to `%<id>` in every pane it starts. */
function tmuxPane(): Hello["tmux"] {
	const socket = process.env.TMUX?.split(",")[0];
	const pane = process.env.TMUX_PANE;
	return socket && pane ? { socket, pane } : undefined;
}

const PREVIEW_CHARS = 120;
function preview(text: string): string {
	return text.trim().split("\n")[0].slice(0, PREVIEW_CHARS);
}

/** Index rows for transcript entries: one per message, plus one per tool call inside an assistant message. */
function indexRows(entry: { type: string; id: string; timestamp: string } & Record<string, any>): IndexRow[] {
	const at = Date.parse(entry.timestamp);
	if (entry.type === "custom_message") {
		const text = textOf(entry.content);
		return [
			{
				entryId: entry.id,
				part: "",
				at,
				role: "custom",
				tool: entry.customType,
				size: text.length,
				preview: preview(text),
			},
		];
	}
	if (entry.type !== "message") return [];
	const message = entry.message;
	const text = textOf(message.content);
	if (message.role === "user")
		return [{ entryId: entry.id, part: "", at, role: "user", size: text.length, preview: preview(text) }];
	if (message.role === "toolResult")
		return [
			{
				entryId: entry.id,
				part: "",
				at,
				role: "tool_result",
				tool: message.toolName,
				size: text.length,
				preview: preview(text),
			},
		];
	if (message.role !== "assistant") return [];
	const rows: IndexRow[] = [
		{ entryId: entry.id, part: "", at, role: "assistant", size: text.length, preview: preview(text) },
	];
	for (const part of Array.isArray(message.content) ? message.content : []) {
		if (part?.type !== "toolCall") continue;
		const args = JSON.stringify(part.arguments ?? {});
		rows.push({
			entryId: entry.id,
			part: part.id,
			at,
			role: "tool_call",
			tool: part.name,
			size: args.length,
			preview: preview(mainArg(part.arguments) ?? args),
		});
	}
	return rows;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => (part?.type === "text" ? part.text : "")).join("");
}

/** The repository, worktree, and branch of `cwd`, or null outside git. One `git rev-parse` call. */
function gitContext(cwd: string): Promise<Facts["git"]> {
	return new Promise((done) => {
		execFile(
			"git",
			["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD", "--git-common-dir"],
			{ cwd, timeout: 5000, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } },
			(error, stdout) => {
				if (error) return done(null);
				const [worktree, branch, commonDir] = stdout.trim().split("\n");
				if (!worktree || !branch || !commonDir) return done(null);
				// The common git directory is <repository>/.git for the main checkout and every linked worktree.
				done({ repository: dirname(resolve(worktree, commonDir)), worktree, branch });
			},
		);
	});
}

export default function sessionStateBridge(pi: ExtensionAPI): void {
	if (process.env.PI_SESSION_STATE_DISABLED === "1") return;
	// The tmux-sessions extension registers this flag too; Pi lets each extension read only flags it registered.
	pi.registerFlag("reports-to", {
		type: "string",
		description: "Session id of the coordinator this session reports to",
	});
	let link: StateLink | undefined;
	let current: ExtensionContext | undefined;
	let skills: string[] = [];
	let mcpServers: string[] = [];
	let watcher: NodeJS.Timeout | undefined;
	const refreshGit = (ctx: ExtensionContext) => {
		const target = link;
		void gitContext(ctx.cwd).then((git) => {
			if (link === target) target?.facts({ git });
		});
	};
	// The ledger extension announces every touch of a task; only this session's touches count here.
	pi.events.on(LEDGER_LINK_CHANNEL, (data) => {
		const touch = data as LedgerLink;
		if (!link || touch.sessionId !== link.hello.session.id) return;
		link.facts({ currentTask: { bundle: touch.bundle, taskId: touch.taskId } });
		link.taskLink(touch.bundle, touch.taskId, touch.via);
	});
	// Steers and follow-ups the operator typed during a run. Pi delivers steers before follow-ups, one user message each.
	let queued = { steers: 0, followUps: 0 };
	const reportQueue = (ctx: ExtensionContext) =>
		link?.facts({ queue: { ...queued, pending: ctx.hasPendingMessages() } });
	// Top-level tools now running, in start order; Pi may run several at once.
	let tools = new Map<string, Tool>();
	// Transcript entries are append-only, so the count of entries already indexed is enough to find new ones.
	let indexed = 0;
	const indexNew = (ctx: ExtensionContext) => {
		if (!link) return;
		const entries = ctx.sessionManager.getEntries();
		if (entries.length <= indexed) return;
		const rows: IndexRow[] = [];
		for (const entry of entries.slice(indexed)) rows.push(...indexRows(entry as never));
		indexed = entries.length;
		link.index(rows);
	};
	const stop = () => {
		clearInterval(watcher);
		watcher = undefined;
	};

	// Resolved when the current run settles; an abort is applied only once the run has stopped.
	const settledWaiters: (() => void)[] = [];
	const settled = (ctx: ExtensionContext) =>
		ctx.isIdle() ? Promise.resolve() : new Promise<void>((resolve) => settledWaiters.push(resolve));
	/** Carry out a command from the runtime with Pi's own calls, reporting each stage back. */
	const apply = async (commandId: string, command: Command) => {
		const target = link;
		const ctx = current;
		if (!target || !ctx) return;
		target.progress(commandId, "delivered");
		const fail = (reason: string) => target.progress(commandId, "failed", reason);
		try {
			switch (command.kind) {
				case "talk":
					if (!ctx.isIdle()) return fail("busy: send steer or follow_up while a run is active");
					pi.sendUserMessage(command.text);
					break;
				case "steer":
					pi.sendUserMessage(command.text, { deliverAs: "steer" });
					break;
				case "follow_up":
					pi.sendUserMessage(command.text, { deliverAs: "followUp" });
					break;
				case "abort":
					ctx.abort();
					await settled(ctx);
					break;
				case "rename":
					pi.setSessionName(command.name);
					break;
				case "set_thinking":
					pi.setThinkingLevel(command.level as never);
					break;
				case "set_model": {
					const model = ctx.modelRegistry.find(command.provider, command.id);
					if (!model) return fail(`unknown model ${command.provider}/${command.id}`);
					if (!(await pi.setModel(model))) return fail(`model ${command.provider}/${command.id} is not available`);
					break;
				}
				default:
					return fail(`unknown command ${(command as { kind: string }).kind}`);
			}
			target.progress(commandId, "applied");
		} catch (error) {
			fail((error as Error).message);
		}
	};

	pi.on("session_start", (event, ctx) => {
		link?.close();
		stop();
		current = ctx;
		queued = { steers: 0, followUps: 0 };
		tools = new Map();
		indexed = 0;
		let warned = false;
		const warn = (message: string) => {
			if (warned) return;
			warned = true;
			if (ctx.hasUI) ctx.ui.notify(message, "warning");
			else process.stderr.write(`${message}\n`);
		};
		// A switch, resume, or fork in this process names the session file that ran here before.
		const previous = event.previousSessionFile ? { file: event.previousSessionFile, reason: event.reason } : null;
		link = new StateLink(helloFor(pi, ctx, skills, mcpServers, previous), warn, (commandId, command) => {
			void apply(commandId, command);
		});
		refreshGit(ctx);
		indexNew(ctx);
		// Messages can be appended while the session is idle (passive forks, extensions); look for them each second.
		watcher = setInterval(() => current && indexNew(current), 1000);
		watcher.unref();
	});
	pi.on("session_shutdown", (event) => {
		stop();
		link?.close(event.reason === "reload" ? undefined : event.reason);
		link = undefined;
		current = undefined;
	});

	pi.on("before_agent_start", (event, ctx) => {
		skills = (event.systemPromptOptions?.skills ?? []).map((skill) => skill.name).sort();
		link?.facts({ config: config(pi, ctx, skills, mcpServers) });
	});
	pi.on("mcp_servers_change", (event, ctx) => {
		mcpServers = event.servers.map((server) => server.name).sort();
		link?.facts({ config: config(pi, ctx, skills, mcpServers) });
	});
	pi.on("session_info_changed", (_event, ctx) => link?.facts({ config: config(pi, ctx, skills, mcpServers) }));
	pi.on("model_select", (_event, ctx) => link?.facts({ model: modelName(ctx), ...contextUsage(ctx) }));
	pi.on("thinking_level_select", (event) => link?.facts({ thinkingLevel: event.level }));

	pi.on("input", (event, ctx) => {
		if (event.streamingBehavior === "steer") queued.steers++;
		else if (event.streamingBehavior === "followUp") queued.followUps++;
		else return { action: "continue" };
		reportQueue(ctx);
		return { action: "continue" };
	});

	pi.on("agent_start", () => link?.run("thinking"));
	pi.on("message_start", (event, ctx) => {
		if (event.message.role === "assistant") link?.run("thinking");
		if (event.message.role === "user" && queued.steers + queued.followUps > 0) {
			if (queued.steers > 0) queued.steers--;
			else queued.followUps--;
			reportQueue(ctx);
		}
	});
	pi.on("message_update", (event) => {
		const type = event.assistantMessageEvent?.type;
		if (type === "text_start" || type === "text_delta") link?.run("writing_reply");
	});
	pi.on("message_end", (event) => {
		const message = event.message;
		if (message.role !== "assistant" || !link) return;
		link.facts({
			cost: link.hello.facts.cost + (message.usage?.cost?.total ?? 0),
			...(message.stopReason === "error" ? { lastError: message.errorMessage ?? "error" } : {}),
		});
	});
	// Context use is read after Pi has saved the turn; at message_end the reply is not in the session yet.
	pi.on("turn_end", (_event, ctx) => {
		link?.facts(contextUsage(ctx));
		reportQueue(ctx);
		indexNew(ctx);
	});

	pi.on("tool_execution_start", (event) => {
		if (event.parentToolCallId || !link) return;
		const tool: Tool = { id: event.toolCallId, name: event.toolName, arg: mainArg(event.args), since: Date.now() };
		tools.set(tool.id, tool);
		link.run("running_tool");
		link.toolStart(tool);
		if (event.toolName === QUESTIONNAIRE_TOOL)
			link.facts({ prompt: { kind: "questionnaire", questions: (event.args as { questions?: unknown })?.questions } });
	});
	pi.on("tool_execution_end", (event) => {
		if (event.parentToolCallId || !link) return;
		const started = tools.get(event.toolCallId);
		tools.delete(event.toolCallId);
		const still = [...tools.values()].at(-1);
		link.toolEnd(event.toolCallId, event.toolName, Date.now() - (started?.since ?? Date.now()), event.isError, still);
		if (!still) link.run("thinking");
		// A command can switch branches or worktrees.
		if (event.toolName === "bash") refreshGit(current ?? ({ cwd: process.cwd() } as ExtensionContext));
		if (event.toolName === QUESTIONNAIRE_TOOL) link.facts({ prompt: null });
	});
	// Other extensions' dialogs report only kind and title; a questionnaire already carries its questions.
	pi.on("ui_prompt_start", (event) => {
		if (link && link.hello.facts.prompt?.kind !== "questionnaire")
			link.facts({ prompt: { kind: event.kind, ...(event.title ? { title: event.title } : {}) } });
	});
	pi.on("ui_prompt_end", () => {
		if (link && link.hello.facts.prompt?.kind !== "questionnaire") link.facts({ prompt: null });
	});

	pi.on("session_before_compact", () => link?.run("compacting"));
	pi.on("session_compact", (_event, ctx) => {
		link?.run(ctx.isIdle() ? "idle" : "thinking");
		link?.facts(contextUsage(ctx));
	});
	pi.on("session_compact_failed", (_event, ctx) => link?.run(ctx.isIdle() ? "idle" : "thinking"));
	pi.on("agent_settled", (event, ctx) => {
		link?.run("idle");
		for (const resolve of settledWaiters.splice(0)) resolve();
		refreshGit(ctx);
		indexNew(ctx);
		if (!ctx.hasPendingMessages()) queued = { steers: 0, followUps: 0 };
		reportQueue(ctx);
		link?.facts({
			...contextUsage(ctx),
			...(event.aborted ? { lastAbortAt: Date.now() } : {}),
			config: config(pi, ctx, skills, mcpServers),
		});
	});
}
