import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { statePaths } from "./paths.js";
import {
	type BridgeMessage,
	type Facts,
	HEARTBEAT_MS,
	type Hello,
	type IndexRow,
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

	constructor(hello: Hello, warn: (message: string) => void) {
		this.hello = hello;
		this.warn = warn;
		this.connect();
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

	index(rows: IndexRow[]): void {
		if (rows.length === 0) return;
		this.rows.push(...rows);
		this.send({ type: "index", rows });
	}

	toolStart(tool: Tool): void {
		this.hello.tool = tool;
		this.send({ type: "tool_start", tool });
	}

	toolEnd(id: string, name: string, isError: boolean): void {
		const since = this.hello.tool?.id === id ? this.hello.tool.since : Date.now();
		if (this.hello.tool?.id === id) this.hello.tool = undefined;
		this.send({ type: "tool_end", id, name, durationMs: Date.now() - since, isError });
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

function config(pi: ExtensionAPI, ctx: ExtensionContext, skills: string[], mcpServers: string[]): Facts["config"] {
	const sources = new Set<string>();
	for (const tool of pi.getAllTools()) if (tool.sourceInfo?.path) sources.add(tool.sourceInfo.path);
	for (const command of pi.getCommands()) if (command.sourceInfo?.path) sources.add(command.sourceInfo.path);
	return {
		name: ctx.sessionManager.getSessionName() ?? null,
		activeTools: [...pi.getActiveTools()].sort(),
		extensions: [...sources].sort(),
		skills,
		mcpServers,
	};
}

function helloFor(pi: ExtensionAPI, ctx: ExtensionContext, skills: string[], mcpServers: string[]): Hello {
	const sessions = ctx.sessionManager;
	return {
		type: "hello",
		session: {
			id: sessions.getSessionId(),
			kind: "root",
			file: sessions.getSessionFile(),
			cwd: ctx.cwd,
			name: sessions.getSessionName(),
		},
		process: { pid: process.pid, startedAt: Math.round(Date.now() - process.uptime() * 1000) },
		tmux: tmuxPane(),
		run: ctx.isIdle() ? "idle" : "thinking",
		facts: {
			model: modelName(ctx),
			thinkingLevel: pi.getThinkingLevel(),
			...contextUsage(ctx),
			cost: sessionCost(ctx),
			prompt: null,
			queue: { steers: 0, followUps: 0 },
			lastError: null,
			lastAbortAt: null,
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

export default function sessionStateBridge(pi: ExtensionAPI): void {
	if (process.env.PI_SESSION_STATE_DISABLED === "1") return;
	let link: StateLink | undefined;
	let skills: string[] = [];
	let mcpServers: string[] = [];
	// Messages typed while a run is busy wait in Pi's queue until delivered as a user message.
	let queued: { kind: "steers" | "followUps"; text: string }[] = [];
	let indexedEntries = new Set<string>();
	const indexNew = (ctx: ExtensionContext) => {
		if (!link) return;
		const rows: IndexRow[] = [];
		for (const entry of ctx.sessionManager.getEntries()) {
			if (indexedEntries.has(entry.id)) continue;
			indexedEntries.add(entry.id);
			rows.push(...indexRows(entry as never));
		}
		link.index(rows);
	};
	const reportQueue = () =>
		link?.facts({
			queue: {
				steers: queued.filter((item) => item.kind === "steers").length,
				followUps: queued.filter((item) => item.kind === "followUps").length,
			},
		});

	pi.on("session_start", (_event, ctx) => {
		link?.close();
		queued = [];
		let warned = false;
		const warn = (message: string) => {
			if (warned) return;
			warned = true;
			if (ctx.hasUI) ctx.ui.notify(message, "warning");
			else process.stderr.write(`${message}\n`);
		};
		link = new StateLink(helloFor(pi, ctx, skills, mcpServers), warn);
		indexedEntries = new Set();
		indexNew(ctx);
	});
	pi.on("turn_end", (_event, ctx) => indexNew(ctx));
	pi.on("session_shutdown", (event) => {
		link?.close(event.reason === "reload" ? undefined : event.reason);
		link = undefined;
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

	pi.on("input", (event) => {
		if (event.streamingBehavior === "steer" || event.streamingBehavior === "followUp") {
			queued.push({ kind: event.streamingBehavior === "steer" ? "steers" : "followUps", text: event.text });
			reportQueue();
		}
		return { action: "continue" };
	});

	pi.on("agent_start", () => link?.run("thinking"));
	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") link?.run("thinking");
		if (event.message.role === "user") {
			const text = textOf(event.message.content);
			const index = queued.findIndex((item) => item.text === text);
			if (index >= 0) {
				queued.splice(index, 1);
				reportQueue();
			}
		}
	});
	pi.on("message_update", (event) => {
		const type = event.assistantMessageEvent?.type;
		if (type === "text_start" || type === "text_delta") link?.run("writing_reply");
	});
	pi.on("message_end", (event, ctx) => {
		const message = event.message;
		if (message.role !== "assistant" || !link) return;
		const cost = link.hello.facts.cost + (message.usage?.cost?.total ?? 0);
		link.facts({
			cost,
			...contextUsage(ctx),
			...(message.stopReason === "error" ? { lastError: message.errorMessage ?? "error" } : {}),
		});
	});

	pi.on("tool_execution_start", (event) => {
		if (event.parentToolCallId || !link) return;
		link.run("running_tool");
		link.toolStart({ id: event.toolCallId, name: event.toolName, arg: mainArg(event.args), since: Date.now() });
		if (event.toolName === QUESTIONNAIRE_TOOL)
			link.facts({ prompt: { kind: "questionnaire", questions: (event.args as { questions?: unknown })?.questions } });
	});
	pi.on("tool_execution_end", (event) => {
		if (event.parentToolCallId || !link) return;
		link.run("thinking");
		link.toolEnd(event.toolCallId, event.toolName, event.isError);
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
		indexNew(ctx);
		if (!ctx.hasPendingMessages() && queued.length > 0) {
			queued = [];
			reportQueue();
		}
		if (event.aborted) link?.facts({ lastAbortAt: Date.now() });
		link?.facts({ config: config(pi, ctx, skills, mcpServers) });
	});
}
