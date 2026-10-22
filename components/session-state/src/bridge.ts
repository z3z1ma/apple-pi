import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	installOrganization,
	SELF_CHANNEL,
	type SelfChange,
	sessionRole,
	sessionSelf,
	sessionSoulLine,
} from "../../organization/src/index.js";
import { type OpenQuestionnaire, QUESTIONNAIRE_CHANNEL } from "../../shared/src/questionnaire-events.js";
import { mainToolArgument } from "../../shared/src/tool-activity.js";
import type { TurnProgress, TurnResult } from "../../shared/src/turn-observer.js";
import { RETRY_MS, spawnRuntime } from "./client.js";
import { installCoordinator } from "./coordinator.js";
import { deliverMail, installMail, mailRecordedIn } from "./mail.js";
import { statePaths } from "./paths.js";
import { installPeerTurns } from "./peer-turns.js";
import { installPeers } from "./peers.js";
import {
	type BridgeMessage,
	type Command,
	type Facts,
	HEARTBEAT_MS,
	type Hello,
	type IndexRow,
	lineReader,
	PROGRAM_ID_ENV,
	PROGRAM_PARENT_ENV,
	type RunState,
	type Tool,
} from "./protocol.js";
import { goalText } from "./work.js";
import { installWork } from "./work-tools.js";

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
	private heldDelta?: { type: "reply_delta"; streamId: string; seq: number; delta: string };
	private awaitingDrain = false;
	private readonly heldTurns = new Map<string, TurnProgress>();
	private turnsAwaitingDrain = false;
	private readonly warn: (message: string) => void;
	private readonly onCommand: (link: StateLink, commandId: string, command: Command, replay: boolean) => void;
	private readonly onDisconnect: () => void;

	constructor(
		hello: Hello,
		warn: (message: string) => void,
		onCommand: (link: StateLink, commandId: string, command: Command, replay: boolean) => void,
		onDisconnect: () => void,
	) {
		this.hello = hello;
		this.warn = warn;
		this.onCommand = onCommand;
		this.onDisconnect = onDisconnect;
		this.connect();
	}

	progress(commandId: string, stage: "delivered" | "applied" | "failed", reason?: string, result?: TurnResult): void {
		if (stage !== "delivered") this.heldTurns.delete(commandId);
		this.send({
			type: "command_progress",
			commandId,
			stage,
			...(reason ? { reason } : {}),
			...(result ? { result } : {}),
		});
	}

	turnProgress(commandId: string, progress: TurnProgress): void {
		if (!this.connected || this.closed || !this.socket) return;
		if (this.socket.writableNeedDrain) {
			this.heldTurns.set(commandId, progress);
			if (!this.turnsAwaitingDrain) {
				this.turnsAwaitingDrain = true;
				this.socket.once("drain", () => {
					this.turnsAwaitingDrain = false;
					const held = [...this.heldTurns];
					this.heldTurns.clear();
					for (const [id, value] of held) this.turnProgress(id, value);
				});
			}
			return;
		}
		this.send({ type: "turn_progress", commandId, progress });
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

	/**
	 * Mail one person from this session in a new thread, without waiting; the runtime reads it even if this link
	 * closes right after.
	 */
	mail(to: string, subject: string, body: string): boolean {
		if (!this.connected) return false;
		const thread = `t-${randomUUID().slice(0, 8)}`;
		const command: Command = { kind: "thread_post", thread, subject, body, to: [to] };
		this.send({ type: "command", commandId: randomUUID(), sessionId: this.hello.session.id, command });
		return true;
	}

	index(rows: IndexRow[]): void {
		if (rows.length === 0) return;
		this.rows.push(...rows);
		this.send({ type: "index", rows });
	}

	/**
	 * Transient reply text: not kept for a reconnect, and dropped while the runtime is away. While the socket needs
	 * draining, deltas are coalesced into one held delta instead of queueing a line each, so Pi's stream never waits.
	 */
	replyDelta(streamId: string, seq: number, delta: string): void {
		if (!this.connected || !this.socket) return;
		const held = this.heldDelta;
		if (held?.streamId === streamId) {
			this.heldDelta = { ...held, seq, delta: held.delta + delta };
			return;
		}
		if (held) this.flushDelta(); // a new stream: the old one's text goes first
		if (this.socket.writableNeedDrain) {
			this.heldDelta = { type: "reply_delta", streamId, seq, delta };
			if (!this.awaitingDrain) {
				// One listener per stall: a heartbeat may flush the held delta before the drain, and the next delta holds again.
				this.awaitingDrain = true;
				this.socket.once("drain", () => {
					this.awaitingDrain = false;
					this.flushDelta();
				});
			}
			return;
		}
		this.send({ type: "reply_delta", streamId, seq, delta });
	}

	replyEnd(streamId: string, messageEntryId: string | undefined): void {
		this.send({ type: "reply_end", streamId, ...(messageEntryId ? { messageEntryId } : {}) });
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
			// A runtime that dies later may be restarted by this bridge again.
			this.spawned = false;
			this.send(this.hello);
			if (this.rows.length > 0) this.send({ type: "index", rows: this.rows });
			this.heartbeat = setInterval(() => this.send({ type: "heartbeat" }), HEARTBEAT_MS);
			this.heartbeat.unref();
		});
		socket.on(
			"data",
			lineReader((line) => {
				let message: { type?: string; commandId?: string; command?: Command; replay?: boolean };
				try {
					message = JSON.parse(line);
				} catch {
					return;
				}
				if (!this.closed && message.type === "command" && message.commandId && message.command)
					this.onCommand(this, message.commandId, message.command, message.replay === true);
			}),
		);
		socket.on("error", () => {});
		socket.on("close", () => {
			this.connected = false;
			this.heldDelta = undefined;
			this.awaitingDrain = false;
			this.heldTurns.clear();
			this.turnsAwaitingDrain = false;
			clearInterval(this.heartbeat);
			if (this.closed) return;
			this.onDisconnect();
			if (!this.spawned) {
				this.spawned = true;
				spawnRuntime(this.warn);
			}
			this.retry = setTimeout(() => this.connect(), RETRY_MS);
			this.retry.unref();
		});
		socket.unref();
	}

	/** Write the held delta, if any. */
	private flushDelta(): void {
		const held = this.heldDelta;
		this.heldDelta = undefined;
		if (held) this.send(held);
	}

	private send(message: BridgeMessage): void {
		// Held reply text goes before anything sent after it, such as the reply's end.
		if (this.heldDelta) this.flushDelta();
		if (this.connected && this.socket) this.socket.write(`${JSON.stringify(message)}\n`);
	}
}

/** Pi writes a session's file once it holds such an entry (`SessionManager._hasConversation`). */
const isConversation = (entry: SessionEntry) =>
	entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant");

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
	return {
		type: "hello",
		session: {
			id: sessions.getSessionId(),
			kind: "root",
			file: sessions.getSessionFile(),
			cwd: ctx.cwd,
			name: sessions.getSessionName(),
			...(process.env[PROGRAM_ID_ENV] && process.env[PROGRAM_PARENT_ENV]
				? { program: { id: process.env[PROGRAM_ID_ENV]!, parent: process.env[PROGRAM_PARENT_ENV]! } }
				: {}),
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
			queue: { steers: 0, followUps: 0, pending: false },
			lastError: null,
			lastAbortAt: null,
			reportsTo: (pi.getFlag("reports-to") as string | undefined) || null,
			role: sessionRole(ctx)?.name ?? null,
			title: sessionRole(ctx)?.title ?? null,
			manages: sessionRole(ctx)?.manages ?? null,
			soul: sessionSoulLine(ctx) ?? null,
			self: sessionSelf(ctx) ?? null,
			parentSessionFile: sessions.getHeader()?.parentSession ?? null,
			previousSession,
			git: null,
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
			preview: preview(mainToolArgument(part.arguments) ?? args),
		});
	}
	return rows;
}

function textOf(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content.map((part) => (part?.type === "text" ? part.text : "")).join("");
}

/**
 * The repository, worktree, and branch of `cwd`: null when git says it is not a repository, undefined when the
 * read failed (a timeout, no git), which proves nothing and keeps the last known context.
 */
function gitContext(cwd: string): Promise<Facts["git"] | undefined> {
	return new Promise((done) => {
		execFile(
			"git",
			["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD", "--path-format=absolute", "--git-common-dir"],
			{ cwd, timeout: 5000, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } },
			(error, stdout, stderr) => {
				if (error) return done(/not a git repository/i.test(String(stderr)) ? null : undefined);
				const [worktree, branch, commonDir] = stdout.trim().split("\n");
				if (!worktree || !branch || !commonDir) return done(undefined);
				// The common git directory is <repository>/.git for the main checkout and every linked worktree.
				// Absolute, in git's own spelling of the path, like --show-toplevel (a relative one is relative to cwd).
				done({ repository: dirname(commonDir), worktree, branch });
			},
		);
	});
}

/**
 * Mail ids handed to Pi that its transcript does not hold yet, per session id. They live on `globalThis` because Pi's
 * queue survives an extension reload, and the next bridge must not hand over again what that queue still holds.
 */
const HANDED_OVER = Symbol.for("apple-pi.session-state.mail-handed-over");
function handedOver(sessionId: string): Set<string> {
	const global = globalThis as Record<symbol, Map<string, Set<string>> | undefined>;
	const all = global[HANDED_OVER] ?? new Map<string, Set<string>>();
	global[HANDED_OVER] = all;
	let ids = all.get(sessionId);
	if (!ids) {
		ids = new Set();
		all.set(sessionId, ids);
	}
	return ids;
}

export default function sessionStateBridge(pi: ExtensionAPI): void {
	// Registered even when switched off: Pi exits with "Unknown option" on a flag no extension registered.
	pi.registerFlag("reports-to", {
		type: "string",
		description: "Session id of the manager this session reports to; mailed when this session closes",
	});
	pi.registerFlag("role", {
		type: "string",
		description: "Role from the role catalog this session takes for life at its first start",
	});
	if (process.env.PI_SESSION_STATE_DISABLED === "1") return;
	installMail(pi);
	// The role resolves at session start before the hello below reads it and the manager tools reconcile on it.
	installOrganization(pi);
	installPeers(pi);
	installCoordinator(pi);
	installWork(pi);
	const peerTurns = installPeerTurns(pi);
	let link: StateLink | undefined;
	let current: ExtensionContext | undefined;
	let skills: string[] = [];
	let mcpServers: string[] = [];
	let watcher: NodeJS.Timeout | undefined;
	const refreshGit = (ctx: ExtensionContext) => {
		const target = link;
		void gitContext(ctx.cwd).then((git) => {
			if (git !== undefined && link === target) target?.facts({ git });
		});
	};
	// Questionnaires the tool shows now, by tool call id, which an `answer` command can answer.
	const questionnaires = new Map<string, OpenQuestionnaire>();
	pi.events.on(QUESTIONNAIRE_CHANNEL, (data) => {
		const open = data as OpenQuestionnaire;
		const target = link;
		if (!target || open.sessionId !== target.hello.session.id) return;
		questionnaires.set(open.toolCallId, open);
		target.facts({ prompt: { kind: "questionnaire", id: open.toolCallId, questions: open.questions } });
		void open.closed.then(() => {
			questionnaires.delete(open.toolCallId);
			if (target.hello.facts.prompt?.id === open.toolCallId) target.facts({ prompt: null });
		});
	});
	// A person rewrote its self.
	pi.events.on(SELF_CHANNEL, (data) => {
		const change = data as SelfChange;
		if (link && change.sessionId === link.hello.session.id) link.facts({ self: change.self });
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
		const fresh = entries.slice(indexed);
		for (const entry of fresh) rows.push(...indexRows(entry as never));
		indexed = entries.length;
		link.index(rows);
		for (const id of mailRecordedIn(fresh)) recorded.add(id);
		acknowledgeMail(link, entries);
	};
	// Mail in the transcript but not yet reported applied. Pi writes a new session's file only once it holds a user
	// or assistant message; until then a lost process would lose mail that looked recorded.
	const recorded = new Set<string>();
	const acknowledgeMail = (target: StateLink, entries: SessionEntry[]) => {
		if (recorded.size === 0 || !entries.some(isConversation)) return;
		for (const id of recorded) {
			handedOver(target.hello.session.id).delete(id);
			target.progress(id, "applied");
		}
		recorded.clear();
	};
	// The assistant reply streaming now, from its first text delta until its turn ends.
	let stream: { id: string; seq: number } | undefined;
	const endStream = (messageEntryId?: string) => {
		if (stream) link?.replyEnd(stream.id, messageEntryId);
		stream = undefined;
	};
	// Until its first run, a process that just started takes mail with the next turn (see `deliverMail`).
	let startingUp = false;
	const stop = () => {
		clearInterval(watcher);
		watcher = undefined;
	};

	// Resolved when the current run settles; an abort is applied only once the run has stopped.
	const settledWaiters: (() => void)[] = [];
	const settled = (ctx: ExtensionContext) =>
		ctx.isIdle() ? Promise.resolve() : new Promise<void>((resolve) => settledWaiters.push(resolve));
	/** Carry out a command from the runtime with Pi's own calls, reporting each stage back. */
	const apply = async (from: StateLink, commandId: string, command: Command, replay: boolean) => {
		const target = link;
		const ctx = current;
		// A command that reached a link this session already replaced was meant for the session before it.
		if (!target || !ctx || from !== target) return;
		target.progress(commandId, "delivered");
		const fail = (reason: string) => target.progress(commandId, "failed", reason);
		// Pi reports a missing model only asynchronously, after the message was taken.
		if ((command.kind === "talk" || command.kind === "steer" || command.kind === "follow_up") && !ctx.model)
			return fail("no model selected");
		try {
			switch (command.kind) {
				case "run_turn":
					peerTurns.enqueue({
						...command,
						id: commandId,
						progress: (progress) => target.turnProgress(commandId, progress),
						finish: (result) =>
							target.progress(commandId, result.status === "completed" ? "applied" : "failed", result.error, result),
					});
					return;
				case "cancel_turn":
					peerTurns.cancel(command.turn);
					break;
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
				case "transfer":
					target.hello.facts.reportsTo = command.manager;
					break;
				case "set_thinking":
					pi.setThinkingLevel(command.level as never);
					break;
				case "answer": {
					const open = questionnaires.get(command.questionnaire);
					if (!open) return fail(`questionnaire ${command.questionnaire} is not open`);
					const refused = open.answer(command.replies);
					if (refused) return fail(refused);
					break;
				}
				case "mail": {
					const entries = ctx.sessionManager.getEntries();
					if (mailRecordedIn(entries).has(commandId)) {
						recorded.add(commandId);
						acknowledgeMail(target, entries);
						return;
					}
					const pending = handedOver(target.hello.session.id);
					if (!pending.has(commandId)) {
						pending.add(commandId);
						// Only mail that waited for this process rides the next turn while it starts up.
						const mail = {
							id: commandId,
							from: command.from,
							ts: command.sentAt,
							body: command.taskGoal
								? `${command.body}\n\n${goalText(ctx.sessionManager.getSessionId()) ?? "You no longer have a focused task."}`
								: command.body,
							...(command.thread ? { thread: command.thread, subject: command.subject } : {}),
							...(command.fromName ? { fromName: command.fromName } : {}),
						};
						deliverMail(pi, mail, startingUp && replay);
					}
					return; // applied once the transcript records it
				}
				case "close":
					target.progress(commandId, "applied");
					// Pi's shutdown waits for a running turn to settle; stop it first.
					ctx.abort();
					ctx.shutdown();
					return;
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
		startingUp = event.reason === "startup";
		recorded.clear();
		// Any start but a reload is a new agent session, whose queue holds none of the mail handed over before.
		if (event.reason !== "reload") handedOver(ctx.sessionManager.getSessionId()).clear();
		queued = { steers: 0, followUps: 0 };
		tools = new Map();
		indexed = 0;
		stream = undefined;
		let warned = false;
		const warn = (message: string) => {
			if (warned) return;
			warned = true;
			if (ctx.hasUI) ctx.ui.notify(message, "warning");
			else process.stderr.write(`${message}\n`);
		};
		// A switch, resume, or fork in this process names the session file that ran here before.
		const previous = event.previousSessionFile ? { file: event.previousSessionFile, reason: event.reason } : null;
		link = new StateLink(
			helloFor(pi, ctx, skills, mcpServers, previous),
			warn,
			(from, commandId, command, replay) => {
				void apply(from, commandId, command, replay);
			},
			() => peerTurns.disconnect(),
		);
		refreshGit(ctx);
		indexNew(ctx);
		// Messages can be appended while the session is idle (passive forks, extensions); look for them each second.
		watcher = setInterval(() => current && indexNew(current), 1000);
		watcher.unref();
	});
	pi.on("session_shutdown", (event) => {
		stop();
		for (const resolve of settledWaiters.splice(0)) resolve();
		const reportsTo = link?.hello.facts.reportsTo;
		if (link && current && reportsTo && !link.hello.session.program && event.reason !== "reload") {
			const name = current.sessionManager.getSessionName();
			const status = link.hello.facts.prompt ? "waiting" : link.hello.run === "idle" ? "idle" : "busy";
			const body = `Session${name ? ` "${name}"` : ""} closed (${event.reason}) while ${status}. Directory: ${current.cwd}`;
			// Shutdown must go on, so with the runtime unreachable the notice is dropped, and said so.
			if (!link.mail(reportsTo, `Closed: ${name ?? current.cwd}`, body))
				process.stderr.write(
					`Session state: the close notice to ${reportsTo} was not sent: the runtime is unreachable\n`,
				);
		}
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

	pi.on("agent_start", () => {
		startingUp = false;
		link?.run("thinking");
	});
	pi.on("message_start", (event, ctx) => {
		if (event.message.role === "assistant") link?.run("thinking");
		if (event.message.role === "user" && queued.steers + queued.followUps > 0) {
			if (queued.steers > 0) queued.steers--;
			else queued.followUps--;
			reportQueue(ctx);
		}
	});
	pi.on("message_update", (event) => {
		const update = event.assistantMessageEvent;
		if (update?.type === "text_start" || update?.type === "text_delta") link?.run("writing_reply");
		if (update?.type !== "text_delta" || !update.delta || !link) return;
		stream ??= { id: randomUUID(), seq: 0 };
		link.replyDelta(stream.id, ++stream.seq, update.delta);
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
	pi.on("turn_end", (event, ctx) => {
		link?.facts(contextUsage(ctx));
		reportQueue(ctx);
		indexNew(ctx);
		// After the index, so a client told the entry id can read it.
		endStream(event.messageEntryId);
	});

	pi.on("tool_execution_start", (event) => {
		if (event.parentToolCallId || !link) return;
		const tool: Tool = {
			id: event.toolCallId,
			name: event.toolName,
			arg: mainToolArgument(event.args),
			since: Date.now(),
		};
		tools.set(tool.id, tool);
		link.run("running_tool");
		link.toolStart(tool);
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
	// An abort during a compaction outside a run ends when the compaction does.
	const compactionEnded = (ctx: ExtensionContext) => {
		link?.run(ctx.isIdle() ? "idle" : "thinking");
		if (ctx.isIdle()) for (const resolve of settledWaiters.splice(0)) resolve();
	};
	pi.on("session_compact", (_event, ctx) => {
		compactionEnded(ctx);
		link?.facts(contextUsage(ctx));
	});
	pi.on("session_compact_failed", (_event, ctx) => compactionEnded(ctx));
	pi.on("agent_settled", (event, ctx) => {
		// A completed run has recorded every steer it was given; an aborted one may have dropped its queue or kept it.
		if (!event.aborted) handedOver(ctx.sessionManager.getSessionId()).clear();
		link?.run("idle");
		for (const resolve of settledWaiters.splice(0)) resolve();
		refreshGit(ctx);
		indexNew(ctx);
		endStream(); // a stream whose turn never ended (normally `turn_end` ended it)
		if (!ctx.hasPendingMessages()) queued = { steers: 0, followUps: 0 };
		reportQueue(ctx);
		link?.facts({
			...contextUsage(ctx),
			...(event.aborted ? { lastAbortAt: Date.now() } : {}),
			config: config(pi, ctx, skills, mcpServers),
		});
	});
}
