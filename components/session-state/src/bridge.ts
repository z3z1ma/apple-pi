import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createConnection, type Socket } from "node:net";
import { dirname } from "node:path";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	installOrganization,
	organizationOf,
	SELF_CHANNEL,
	type SelfChange,
	sessionRole,
	sessionSelf,
	sessionSoulLine,
} from "../../organization/src/index.js";
import { OPERATOR_PAGE_CHANNEL, type OpenOperatorPage } from "../../shared/src/operator-page-events.js";
import { type OpenQuestionnaire, QUESTIONNAIRE_CHANNEL } from "../../shared/src/questionnaire-events.js";
import { mainToolArgument } from "../../shared/src/tool-activity.js";
import type { TurnProgress, TurnResult } from "../../shared/src/turn-observer.js";
import { RETRY_MS, sendCommand, spawnRuntime } from "./client.js";
import { installCoordinator } from "./coordinator.js";
import { deliverMail, installMail, mailRecordedIn } from "./mail.js";
import { statePaths } from "./paths.js";
import { installPeerTurns } from "./peer-turns.js";
import { installPeers } from "./peers.js";
import { forkBoundary, PROGRAM_FORK_ENTRY, recordProgramFork, sessionCost } from "./program-fork.js";
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
	type Prompt,
	type RunState,
	type Tool,
} from "./protocol.js";
import { coveredByReviewWait } from "./review-waits.js";
import { type RunObservation, RunObserver, type RunSnapshot } from "./run-observation.js";
import { goalText } from "./work.js";

function mailBody(command: Extract<Command, { kind: "mail" }>, covered: boolean, session: string): string {
	if (covered) return "Delivered in your review wait result.";
	if (!command.taskGoal) return command.body;
	return `${command.body}\n\n${goalText(session) ?? "You no longer have a focused task."}`;
}

import { installWork } from "./work-tools.js";

class StateLink {
	private socket?: Socket;
	private connected = false;
	private closed = false;
	private spawned = false;
	private heartbeat?: NodeJS.Timeout;
	private retry?: NodeJS.Timeout;
	readonly hello: Hello;

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

	observe(observation: RunObservation, snapshot: RunSnapshot): void {
		this.hello.execution = snapshot;
		this.send({ type: "execution", observation });
	}

	run(run: RunState): void {
		if (this.hello.run === run) return;
		this.hello.run = run;
		this.send({ type: "run", run });
	}

	facts(patch: Partial<Facts>): void {
		const changed: Partial<Facts> = {};
		for (const [key, value] of Object.entries(patch) as [keyof Facts, unknown][]) {
			if (JSON.stringify(this.hello.facts[key]) === JSON.stringify(value)) continue;
			(this.hello.facts as unknown as Record<string, unknown>)[key] = value;
			(changed as Record<string, unknown>)[key] = value;
		}
		if (Object.keys(changed).length > 0) this.send({ type: "facts", facts: changed });
	}

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

	replyDelta(streamId: string, seq: number, delta: string): void {
		if (!this.connected || !this.socket) return;
		const held = this.heldDelta;
		if (held?.streamId === streamId) {
			this.heldDelta = { ...held, seq, delta: held.delta + delta };
			return;
		}
		if (held) this.flushDelta();
		if (this.socket.writableNeedDrain) {
			this.heldDelta = { type: "reply_delta", streamId, seq, delta };
			if (!this.awaitingDrain) {
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

	toolEnd(id: string, name: string, durationMs: number, isError: boolean, current: Tool | undefined): void {
		this.hello.tool = current;
		this.send({ type: "tool_end", id, name, durationMs, isError, current: current ?? null });
	}

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

	private flushDelta(): void {
		const held = this.heldDelta;
		this.heldDelta = undefined;
		if (held) this.send(held);
	}

	private send(message: BridgeMessage): void {
		if (this.heldDelta) this.flushDelta();
		if (this.connected && this.socket) this.socket.write(`${JSON.stringify(message)}\n`);
	}
}

const isConversation = (entry: SessionEntry) =>
	entry.type === "message" && (entry.message.role === "user" || entry.message.role === "assistant");

function modelName(ctx: ExtensionContext): string | null {
	return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null;
}

function contextUsage(ctx: ExtensionContext): Pick<Facts, "contextTokens" | "contextWindow"> {
	const usage = ctx.getContextUsage();
	return { contextTokens: usage?.tokens ?? null, contextWindow: usage?.contextWindow ?? null };
}

function flagNames(): string[] {
	return process.argv
		.slice(2)
		.filter((arg) => arg.startsWith("--"))
		.map((arg) => arg.slice(2).split("=")[0])
		.sort();
}

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
	const fork = forkBoundary(sessions);
	return {
		type: "hello",
		session: {
			id: sessions.getSessionId(),
			kind: "root",
			file: sessions.getSessionFile(),
			cwd: ctx.cwd,
			name: sessions.getSessionName(),
			interactive: ctx.hasUI,
			incorporate: pi.getFlag("incorporate") === true,
			...(fork ? { forkOffset: fork.offset } : {}),
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
			cost: sessionCost(sessions),
			prompt: null,
			queue: { steers: 0, followUps: 0, pending: false },
			lastError: null,
			lastAbortAt: null,
			reportsTo: (pi.getFlag("reports-to") as string | undefined) || null,
			role: sessionRole(ctx)?.name ?? null,
			title: sessionRole(ctx)?.title ?? null,
			manages: sessionRole(ctx)?.manages ?? null,
			onCall: sessionRole(ctx)?.dispatches ?? null,
			soul: sessionSoulLine(ctx) ?? null,
			self: sessionSelf(ctx) ?? null,
			parentSessionFile: sessions.getHeader()?.parentSession ?? null,
			previousSession,
			git: null,
			config: config(pi, ctx, skills, mcpServers),
		},
	};
}

function tmuxPane(): Hello["tmux"] {
	const socket = process.env.TMUX?.split(",")[0];
	const pane = process.env.TMUX_PANE;
	return socket && pane ? { socket, pane } : undefined;
}

const PREVIEW_CHARS = 120;

export const NOTICE_CUSTOM_TYPE = "apple-pi.notice";
function preview(text: string): string {
	return text.trim().split("\n")[0].slice(0, PREVIEW_CHARS);
}

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

				done({ repository: dirname(commonDir), worktree, branch });
			},
		);
	});
}

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

const HELD_FOLLOW_UPS = Symbol.for("apple-pi.session-state.held-follow-ups");
function heldFollowUps(sessionId: string): { commandId: string; text: string }[] {
	const global = globalThis as Record<symbol, Map<string, { commandId: string; text: string }[]> | undefined>;
	const all = global[HELD_FOLLOW_UPS] ?? new Map<string, { commandId: string; text: string }[]>();
	global[HELD_FOLLOW_UPS] = all;
	let held = all.get(sessionId);
	if (!held) {
		held = [];
		all.set(sessionId, held);
	}
	return held;
}

export default function sessionStateBridge(pi: ExtensionAPI): void {
	pi.registerFlag("reports-to", {
		type: "string",
		description: "Session id of the manager this session reports to; mailed when this session closes",
	});
	pi.registerFlag("role", {
		type: "string",
		description: "Role from the role catalog this session takes for life at its first start",
	});
	pi.registerFlag("role-profile", {
		type: "string",
		description: "Inference profile that selects the role's mind at its first start, in place of the role's own",
	});
	pi.registerFlag("incorporate", {
		type: "boolean",
		description: "Keep this organization after its root closes; otherwise a new organization is temporary",
	});
	if (process.env.PI_SESSION_STATE_DISABLED === "1") return;
	pi.registerCommand("incorporate", {
		description: "Keep this organization after its root closes and stop pending automatic departures",
		handler: async (_args, ctx) => {
			const person = ctx.sessionManager.getSessionId();
			const root = organizationOf(person).root;
			const receipt = await sendCommand(root, { kind: "incorporate", by: person });
			ctx.ui.notify(
				receipt.stage === "applied"
					? "This organization is incorporated."
					: (receipt.reason ?? "Incorporation failed."),
				receipt.stage === "applied" ? "info" : "error",
			);
		},
	});
	installMail(pi);

	installOrganization(pi, { reflects: !process.env[PROGRAM_ID_ENV] });
	installPeers(pi);
	installCoordinator(pi);
	installWork(pi);
	const peerTurns = installPeerTurns(pi);
	let link: StateLink | undefined;
	let observations: RunObserver | undefined;
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

	const toolPrompts = new Map<string, Prompt>();
	const holdPrompt = (target: StateLink, prompt: Prompt & { id: string }, closed: Promise<void>) => {
		toolPrompts.set(prompt.id, prompt);
		target.facts({ prompt });
		void closed.then(() => {
			toolPrompts.delete(prompt.id);
			if (target.hello.facts.prompt?.id === prompt.id)
				target.facts({ prompt: [...toolPrompts.values()].at(-1) ?? null });
		});
	};

	const questionnaires = new Map<string, OpenQuestionnaire>();
	pi.events.on(QUESTIONNAIRE_CHANNEL, (data) => {
		const open = data as OpenQuestionnaire;
		const target = link;
		if (!target || open.sessionId !== target.hello.session.id) return;
		questionnaires.set(open.toolCallId, open);
		void open.closed.then(() => questionnaires.delete(open.toolCallId));
		holdPrompt(target, { kind: "questionnaire", id: open.toolCallId, questions: open.questions }, open.closed);
	});

	pi.events.on(OPERATOR_PAGE_CHANNEL, (data) => {
		const open = data as OpenOperatorPage;
		const target = link;
		if (!target || open.sessionId !== target.hello.session.id) return;
		holdPrompt(target, { kind: "sign-off", id: open.toolCallId, title: open.title }, open.closed);
	});

	pi.events.on(SELF_CHANNEL, (data) => {
		const change = data as SelfChange;
		if (link && change.sessionId === link.hello.session.id) link.facts({ self: change.self });
	});

	let queued = { steers: 0, followUps: 0 };
	const reportQueue = (ctx: ExtensionContext) => {
		const waiting = heldFollowUps(ctx.sessionManager.getSessionId()).length;
		link?.facts({
			queue: {
				steers: queued.steers,
				followUps: queued.followUps + waiting,
				pending: ctx.hasPendingMessages() || waiting > 0,
			},
		});
	};

	const releaseFollowUps = (ctx: ExtensionContext, aborted: boolean) => {
		const held = heldFollowUps(ctx.sessionManager.getSessionId());
		const waiting = held.splice(0);
		if (!link) return;
		if (aborted) {
			for (const item of waiting) link.progress(item.commandId, "failed", "stopped before it was sent; send it again");
			return;
		}
		waiting.forEach((item, index) => {
			pi.sendUserMessage(item.text, index === 0 ? undefined : { deliverAs: "followUp" });
			link?.progress(item.commandId, "applied");
		});
	};

	let tools = new Map<string, Tool>();

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

	const recorded = new Set<string>();
	const acknowledgeMail = (target: StateLink, entries: SessionEntry[]) => {
		if (recorded.size === 0 || !entries.some(isConversation)) return;
		for (const id of recorded) {
			handedOver(target.hello.session.id).delete(id);
			target.progress(id, "applied");
		}
		recorded.clear();
	};

	let stream: { id: string; seq: number } | undefined;
	const endStream = (messageEntryId?: string) => {
		if (stream) link?.replyEnd(stream.id, messageEntryId);
		stream = undefined;
	};

	let startingUp = false;
	const stop = () => {
		clearInterval(watcher);
		watcher = undefined;
	};

	const settledWaiters: (() => void)[] = [];
	const settled = (ctx: ExtensionContext) =>
		ctx.isIdle() ? Promise.resolve() : new Promise<void>((resolve) => settledWaiters.push(resolve));

	const apply = async (from: StateLink, commandId: string, command: Command, replay: boolean) => {
		const target = link;
		const ctx = current;

		if (!target || !ctx || from !== target) return;
		target.progress(commandId, "delivered");
		const fail = (reason: string) => target.progress(commandId, "failed", reason);

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
					if (ctx.isIdle()) {
						pi.sendUserMessage(command.text);
						break;
					}

					heldFollowUps(ctx.sessionManager.getSessionId()).push({ commandId, text: command.text });
					reportQueue(ctx);
					return;
				case "withdraw": {
					const held = heldFollowUps(ctx.sessionManager.getSessionId());
					const index = held.findIndex((item) => item.commandId === command.command);
					if (index < 0) return fail("already taken: the agent has it");
					held.splice(index, 1);
					target.progress(command.command, "failed", "withdrawn");
					reportQueue(ctx);
					break;
				}
				case "abort":
					ctx.abort();
					await settled(ctx);
					break;
				case "rename":
					pi.setSessionName(command.name);
					break;
				case "notice":
					pi.sendMessage(
						{ customType: NOTICE_CUSTOM_TYPE, content: command.text, display: true },
						{ deliverAs: "steer" },
					);
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

						const covered = coveredByReviewWait(command.reference?.id);
						const mail = {
							id: commandId,
							from: command.from,
							ts: command.sentAt,
							body: mailBody(command, covered, ctx.sessionManager.getSessionId()),
							...(command.thread ? { thread: command.thread, subject: command.subject } : {}),
							...(command.fromName ? { fromName: command.fromName } : {}),
							threadKind: command.threadKind,
							reference: command.reference,
						};
						deliverMail(pi, mail, startingUp && replay, covered);
					}
					return;
				}
				case "close":
					target.progress(commandId, "applied");

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
		observations?.close(event.reason === "reload");
		link?.close();
		stop();
		current = ctx;
		startingUp = event.reason === "startup";
		if (startingUp && process.env[PROGRAM_ID_ENV])
			recordProgramFork(ctx.sessionManager, (data) => pi.appendEntry(PROGRAM_FORK_ENTRY, data));
		recorded.clear();

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

		const previous = event.previousSessionFile ? { file: event.previousSessionFile, reason: event.reason } : null;
		observations = new RunObserver(
			ctx.sessionManager.getSessionId(),
			event.reason === "reload",
			ctx.isIdle(),
			(observation) => {
				if (observations) link?.observe(observation, observations.snapshot());
			},
		);
		link = new StateLink(
			{ ...helloFor(pi, ctx, skills, mcpServers, previous), execution: observations.snapshot() },
			warn,
			(from, commandId, command, replay) => {
				void apply(from, commandId, command, replay);
			},
			() => peerTurns.disconnect(),
		);
		refreshGit(ctx);
		indexNew(ctx);

		watcher = setInterval(() => current && indexNew(current), 1000);
		watcher.unref();
	});
	pi.on("session_shutdown", (event) => {
		observations?.close(event.reason === "reload");
		observations = undefined;
		stop();
		for (const resolve of settledWaiters.splice(0)) resolve();
		const reportsTo = link?.hello.facts.reportsTo;
		if (link && current && reportsTo && !link.hello.session.program && event.reason !== "reload") {
			const name = current.sessionManager.getSessionName();
			const status = link.hello.facts.prompt ? "waiting" : link.hello.run === "idle" ? "idle" : "busy";
			const body = `Session${name ? ` "${name}"` : ""} closed (${event.reason}) while ${status}. Directory: ${current.cwd}`;

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
		observations?.prepare(event);
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
		observations?.start();
		startingUp = false;
		link?.run("thinking");
	});
	pi.on("message_start", (event, ctx) => {
		observations?.consume(event.message);
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

	pi.on("turn_end", (event, ctx) => {
		link?.facts(contextUsage(ctx));
		reportQueue(ctx);
		indexNew(ctx);

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

		if (event.toolName === "bash") refreshGit(current ?? ({ cwd: process.cwd() } as ExtensionContext));
	});

	pi.on("ui_prompt_start", (event) => {
		if (link && toolPrompts.size === 0)
			link.facts({ prompt: { kind: event.kind, ...(event.title ? { title: event.title } : {}) } });
	});
	pi.on("ui_prompt_end", () => {
		if (link && toolPrompts.size === 0) link.facts({ prompt: null });
	});

	pi.on("session_before_compact", () => link?.run("compacting"));

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
		observations?.settle(event.aborted);

		if (!event.aborted) handedOver(ctx.sessionManager.getSessionId()).clear();
		link?.run("idle");
		for (const resolve of settledWaiters.splice(0)) resolve();
		refreshGit(ctx);
		indexNew(ctx);
		endStream();
		if (!ctx.hasPendingMessages()) queued = { steers: 0, followUps: 0 };
		reportQueue(ctx);
		link?.facts({
			...contextUsage(ctx),
			...(event.aborted ? { lastAbortAt: Date.now() } : {}),
			config: config(pi, ctx, skills, mcpServers),
		});
		releaseFollowUps(ctx, event.aborted);
		reportQueue(ctx);
	});
}
