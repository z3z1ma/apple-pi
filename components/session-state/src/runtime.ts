import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmodSync, createReadStream, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import type { TurnResult } from "../../shared/src/turn-observer.js";
import type { StatePaths } from "./paths.js";
import {
	type BridgeMessage,
	type Command,
	type CommandRequest,
	type EntriesReply,
	type EntryReply,
	type Facts,
	type Hello,
	type IndexRow,
	lineReader,
	PROGRAM_ID_ENV,
	PROGRAM_PARENT_ENV,
	type ProcessState,
	type ReadEntries,
	type ReadEntry,
	type Receipt,
	type ReceiptStage,
	type ReplyDelta,
	type ReplyEnd,
	type RunState,
	SILENCE_MS,
	type Tool,
} from "./protocol.js";

/** Where each fact lives in `sessions`; object-valued facts are stored as JSON. */
const FACT_COLUMNS: Record<keyof Facts, string> = {
	model: "model",
	thinkingLevel: "thinking_level",
	contextTokens: "context_tokens",
	contextWindow: "context_window",
	cost: "cost",
	prompt: "prompt",
	queue: "queue",
	lastError: "last_error",
	lastAbortAt: "last_abort_at",
	reportsTo: "reports_to",
	role: "role",
	title: "role_title",
	manages: "manages",
	soul: "soul",
	self: "self",
	parentSessionFile: "parent_session_file",
	previousSession: "previous_session",
	git: "git",
	config: "config",
};
const JSON_FACTS = new Set<string>(["prompt", "queue", "config", "previousSession", "git"]);

import { type AttentionRow, jumpTarget, statusSummary } from "./attention.js";
import { syncChannels } from "./channels.js";
import { RETRY_MS, sendCommand } from "./client.js";
import { discardProgramPeople, programDescendants } from "./program-peers.js";
import { migrate } from "./schema.js";
import { markRead, messagesOf, nameOf, OPERATOR, postToThread, type ThreadPost, threadOf } from "./threads.js";
import {
	canonicalSocket,
	killPane,
	listClients,
	listPanes,
	openWindow,
	type PaneRow,
	setServerOptions,
	socketFiles,
} from "./tmux.js";
import {
	changeWork,
	cleanMovedBundles,
	closeLedgerTask,
	focusedTask,
	openLedgerTask,
	type WorkCommand,
} from "./work.js";

/** How often the runtime reads tmux, and how long one server may take to answer before the read counts as failed. */
const TMUX_POLL_MS = 1000;

type Fields = Record<string, string | number>;

/** The columns each tmux table keeps beside `socket` and `id`, and how to read them from a pane row. */
const TOPOLOGY = [
	{
		table: "tmux_sessions",
		kind: "tmux_session",
		key: (p: PaneRow) => p.sessionId,
		fields: (p: PaneRow): Fields => ({ name: p.sessionName }),
	},
	{
		table: "tmux_windows",
		kind: "tmux_window",
		key: (p: PaneRow) => p.windowId,
		fields: (p: PaneRow): Fields => ({ name: p.windowName }),
	},
	// A window can be linked into several sessions, at a different index in each.
	{
		table: "tmux_window_links",
		kind: "tmux_window_link",
		key: (p: PaneRow) => `${p.sessionId}:${p.windowId}`,
		fields: (p: PaneRow): Fields => ({ session_id: p.sessionId, window_id: p.windowId, window_index: p.windowIndex }),
	},
	{
		table: "tmux_panes",
		kind: "tmux_pane",
		key: (p: PaneRow) => p.paneId,
		fields: (p: PaneRow): Fields => ({
			window_id: p.windowId,
			tty: p.tty,
			pid: p.pid,
			current_command: p.command,
			current_path: p.path,
			active: p.active,
			dead: p.dead,
		}),
	},
];

interface Connection {
	socket: Socket;
	sessionId?: string;
	generation?: number;
	lastSeen: number;
	shutdown: boolean;
	/** The sessions whose live replies this client subscribed to. */
	subscriptions?: Set<string>;
	/**
	 * Stream messages held back while the client's socket needs draining, per session: the last end, and the newest
	 * stream's text coalesced into one delta.
	 */
	held?: Map<string, { end?: ReplyEnd; delta?: ReplyDelta }>;
	heldTurns?: Map<string, Extract<BridgeMessage, { type: "turn_progress" }>>;
	turnsAwaitingDrain?: boolean;
	program?: { id: string; caller: string; closing: boolean; created: Set<string>; discarded: Set<string> };
}

interface SessionLaunch {
	cwd: string;
	name?: string;
	reportsTo?: string;
	role?: string;
	prompt?: string;
	tmux?: Hello["tmux"];
	program?: { id: string; parent: string };
}

interface SessionStart {
	commandId: string;
	socket?: string;
	pane?: string;
	prompt?: string;
}

interface IncarnationRow {
	session_id: string;
	generation: number;
	pid: number;
	process_started_at: number;
	process_state: ProcessState;
	ended_at: number | null;
}

/** Start times from `ps` have one-second resolution; the bridge's own estimate is close to it. */
const START_TOLERANCE_MS = 2000;

function sameStart(a: number, b: number): boolean {
	return Math.abs(a - b) < START_TOLERANCE_MS;
}

export type ProcessCheck = "running" | "gone" | "unknown";

/**
 * Whether the process with this pid is still the one that started at `startedAt` (a pid-reuse guard).
 * "unknown" means the check itself failed; it never counts as proof that the process is gone.
 */
export function checkProcess(pid: number, startedAt: number): ProcessCheck {
	try {
		process.kill(pid, 0);
	} catch (error) {
		const code = (error as NodeJS.ErrnoException).code;
		if (code === "ESRCH") return "gone";
		if (code !== "EPERM") return "unknown";
	}
	const time = processStart(pid);
	if (typeof time !== "number") return time;
	return sameStart(time, startedAt) ? "running" : "gone";
}

function processStart(pid: number): number | "gone" | "unknown" {
	let started: string;
	try {
		started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim();
	} catch (error) {
		const result = error as { status?: number; stdout?: string };
		return result.status === 1 && !result.stdout?.trim() ? "gone" : "unknown";
	}
	if (started === "") return "gone";
	const time = Date.parse(started);
	return Number.isNaN(time) ? "unknown" : time;
}

/**
 * The one writer of the session state database. Bridges connect over the Unix socket; the runtime records
 * what they report and decides liveness from their connection and heartbeats, then from the process itself.
 */
export class Runtime {
	private db?: DatabaseSync;
	private lock?: DatabaseSync;
	private server?: Server;
	private timer?: NodeJS.Timeout;
	private tmuxTimer?: NodeJS.Timeout;
	private polling = false;
	private readonly stopping = new AbortController();
	/** Servers whose last read failed, so a failure is logged and recorded once rather than every second. */
	private readonly failingServers = new Set<string>();
	/** The client that sent each command still in flight, so its receipts reach it. */
	private readonly commandClients = new Map<string, Connection>();
	/** The status-line options last written to each tmux server, so they are written only when they change. */
	private readonly attentionShown = new Map<string, string>();
	/** Sessions this runtime opened a window for, until their bridge connects or the window closes. */
	private readonly starting = new Map<string, SessionStart>();
	private readonly headless = new Map<string, ChildProcess>();
	private readonly retiring = new Map<string, { person: string; controller: AbortController }>();
	private readonly programs = new Map<string, Connection>();
	private readonly discarding = new Set<string>();
	private readonly discardRequests = new Map<string, Set<string>>();
	private readonly signalled = new Map<string, Set<string>>();
	private programTimer?: NodeJS.Timeout;
	private cleaningPrograms = false;
	/** The bridge connection each unsettled command was handed to. */
	private readonly dispatched = new Map<string, Connection>();
	private readonly connections = new Set<Connection>();
	private readonly failedChecks = new Set<string>();
	private readonly paths: StatePaths;

	constructor(paths: StatePaths) {
		this.paths = paths;
	}

	/** False when another runtime holds the lock. */
	async start(): Promise<boolean> {
		mkdirSync(this.paths.dir, { recursive: true, mode: 0o700 });
		if (!this.takeLock()) return false;
		writeFileSync(this.paths.pid, String(process.pid), { mode: 0o600 });
		this.db = new DatabaseSync(this.paths.db);
		this.db.exec("pragma journal_mode = wal");
		migrate(this.db);
		for (const row of this.db
			.prepare(
				"select command_id from commands where kind in ('run_turn', 'discard_peer') and stage in ('accepted', 'delivered')",
			)
			.all() as { command_id: string }[])
			this.setCommandStage(row.command_id, "failed", "The runtime restarted before the program received a result");
		this.db.prepare("update program_scopes set closing = 1").run();
		cleanMovedBundles(this.db);
		syncChannels(this.db, Date.now());
		this.recoverThreadPosts();
		this.recoverWorkCommands();
		this.recoverTaskLifecycle();
		this.recoverRetirements();
		for (const row of this.db.prepare("select session_id as id from program_peers").all() as { id: string }[])
			this.discarding.add(row.id);
		rmSync(this.paths.socket, { force: true }); // we hold the lock, so any socket file is stale
		const server = createServer((socket) => this.accept(socket));
		this.server = server;
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(this.paths.socket, () => resolve());
		});
		chmodSync(this.paths.socket, 0o600);
		this.timer = setInterval(() => this.checkLiveness(), 1000);
		this.tmuxTimer = setInterval(() => void this.pollTmux(), TMUX_POLL_MS);
		this.checkLiveness();
		void this.pollTmux();
		void this.cleanPrograms();
		return true;
	}

	stop(): void {
		clearInterval(this.timer);
		clearInterval(this.tmuxTimer);
		clearTimeout(this.programTimer);
		for (const child of this.headless.values()) child.kill("SIGTERM");
		for (const connection of this.connections) connection.socket.destroy();
		this.stopping.abort();
		this.server?.close();
		rmSync(this.paths.socket, { force: true });
		rmSync(this.paths.pid, { force: true });
		const db = this.db;
		this.db = undefined; // in-flight work sees the runtime stopped instead of a closed database
		db?.close();
		this.lock?.close();
	}

	/** An exclusive SQLite lock: one holder at a time, released by the OS however the holder exits. */
	private takeLock(): boolean {
		const lock = new DatabaseSync(this.paths.lock);
		try {
			lock.exec("pragma locking_mode = exclusive");
			lock.exec("begin exclusive");
		} catch (error) {
			lock.close();
			if (/locked|busy/i.test((error as Error).message)) return false;
			throw error;
		}
		this.lock = lock;
		return true;
	}

	private accept(socket: Socket): void {
		const connection: Connection = { socket, lastSeen: Date.now(), shutdown: false };
		this.connections.add(connection);
		socket.on(
			"data",
			lineReader((line) => {
				connection.lastSeen = Date.now();
				let message: BridgeMessage;
				try {
					message = JSON.parse(line);
				} catch {
					return;
				}
				try {
					this.handle(connection, message);
				} catch (error) {
					// One bad message must not take the runtime down with every other session.
					console.error(`message from a bridge failed: ${(error as Error).stack ?? error}`);
				}
			}),
		);
		socket.on("error", () => {});
		socket.on("close", () => {
			this.connections.delete(connection);
			this.dropCommandsOf(connection);
			if (this.db && connection.program) this.closeProgram(connection);
			this.checkLiveness();
		});
	}

	private handle(connection: Connection, message: BridgeMessage): void {
		if (message.type === "program_open") {
			this.openProgram(connection, message);
			return;
		}
		if (message.type === "program_close") {
			this.closeProgram(connection);
			return;
		}
		if (message.type === "hello") {
			this.hello(connection, message);
			return;
		}
		if (message.type === "command") {
			this.command(connection, message);
			return;
		}
		if (message.type === "command_progress") {
			this.commandProgress(connection, message.commandId, message.stage, message.reason, message.result);
			return;
		}
		if (message.type === "turn_progress") {
			const client = this.commandClients.get(message.commandId);
			if (client && this.dispatched.get(message.commandId) === connection) this.turnProgress(client, message);
			return;
		}
		if (message.type === "read_entry") {
			this.readEntry(connection, message).catch((error) =>
				console.error(`read_entry failed: ${(error as Error).stack ?? error}`),
			);
			return;
		}
		if (message.type === "subscribe") {
			const ids = Array.isArray(message.sessionIds)
				? message.sessionIds.filter((id): id is string => typeof id === "string")
				: [];
			connection.subscriptions = new Set(ids);
			connection.socket.write(`${JSON.stringify({ type: "subscribed", sessionIds: ids })}\n`);
			return;
		}
		if (message.type === "read_entries") {
			this.readEntries(connection, message).catch((error) =>
				console.error(`read_entries failed: ${(error as Error).stack ?? error}`),
			);
			return;
		}
		const { sessionId, generation } = connection;
		if (sessionId === undefined || generation === undefined) return;
		if (message.type === "reply_delta" || message.type === "reply_end") {
			// Transient: relayed to subscribers of the current generation, never written to the database.
			if (this.isCurrent(sessionId, generation)) this.relay({ ...message, sessionId } as ReplyDelta | ReplyEnd);
			return;
		}
		if (message.type === "run") this.setRunState(sessionId, generation, message.run);
		else if (message.type === "index") this.index(sessionId, generation, message.rows);
		else if (message.type === "facts") this.applyFacts(sessionId, generation, message.facts);
		else if (message.type === "tool_start") this.startTool(sessionId, generation, message.tool);
		else if (message.type === "tool_end") {
			// Every end is recorded, even of a tool that was not the one shown; the session then shows the tool still running.
			const { id, name, durationMs, isError, current } = message;
			if (this.isCurrent(sessionId, generation)) {
				this.event("bridge", sessionId, generation, "tool_ended", { id, name, durationMs, isError });
				if (current) this.showTool(sessionId, current);
				else this.clearTool(sessionId, generation);
			}
		} else if (message.type === "shutdown") {
			connection.shutdown = true;
			this.endIncarnation(sessionId, generation, "exited", "bridge", message.reason);
			this.setRunState(sessionId, generation, "idle");
		}
	}

	private hello(connection: Connection, hello: Hello): void {
		const db = this.db!;
		const now = Date.now();
		const { session, process: proc } = hello;
		const recorded = db
			.prepare("select program_id, created_by as program_parent from program_peers where session_id = ?")
			.get(session.id) as { program_id: string; program_parent: string } | undefined;
		if (recorded || session.program) {
			const owner = session.program && this.programs.get(session.program.id)?.program;
			if (
				!session.program ||
				!owner ||
				owner.closing ||
				owner.discarded.has(session.id) ||
				this.discarding.has(session.id) ||
				recorded?.program_id !== session.program.id ||
				recorded.program_parent !== session.program.parent
			) {
				connection.socket.write(
					`${JSON.stringify({ type: "command", commandId: randomUUID(), sessionId: session.id, command: { kind: "close" } })}\n`,
				);
				return;
			}
		}
		const latest = db
			.prepare("select * from incarnations where session_id = ? order by generation desc limit 1")
			.get(session.id) as IncarnationRow | undefined;
		let generation: number;
		if (
			latest &&
			latest.ended_at === null &&
			latest.pid === proc.pid &&
			sameStart(latest.process_started_at, proc.startedAt)
		) {
			generation = latest.generation; // the same process reconnecting, for example after /reload
			this.recordGap(connection, session.id, generation);
			this.setProcessState(session.id, generation, "alive", "bridge");
		} else {
			if (latest && latest.ended_at === null) {
				// The old process may still run; it stays under liveness tracking until it is gone.
				const check = checkProcess(latest.pid, latest.process_started_at);
				this.endIncarnation(
					session.id,
					latest.generation,
					check === "gone" ? "lost" : "alive_bridge_lost",
					"runtime",
					"superseded",
				);
			}
			generation = (latest?.generation ?? 0) + 1;
			const tmuxSocket = hello.tmux ? canonicalSocket(hello.tmux.socket) : null;
			db.prepare(
				`insert into incarnations (session_id, generation, pid, process_started_at, process_state, started_at, source, updated_at,
					tmux_socket, pane_id)
				values (?, ?, ?, ?, 'alive', ?, 'bridge', ?, ?, ?)`,
			).run(session.id, generation, proc.pid, proc.startedAt, now, now, tmuxSocket, hello.tmux?.pane ?? null);
			this.event("bridge", session.id, generation, "incarnation_started", {
				pid: proc.pid,
				tmux: hello.tmux ? { socket: tmuxSocket, pane: hello.tmux.pane } : null,
			});
			this.bindPaneTtys();
			if (hello.tmux) void this.pollTmux();
		}
		const before = db.prepare("select spawned_by from sessions where id = ?").get(session.id) as
			| { spawned_by: string | null }
			| undefined;
		if (session.spawnedBy && before?.spawned_by !== session.spawnedBy)
			this.event("bridge", session.id, generation, "spawned_by", { spawnedBy: session.spawnedBy });
		db.prepare(
			`insert into sessions (id, kind, spawned_by, session_file, cwd, name, run_state, generation, source, updated_at)
			values (?, ?, ?, ?, ?, ?, 'idle', ?, 'bridge', ?)
			on conflict (id) do update set kind = excluded.kind, spawned_by = excluded.spawned_by, session_file = excluded.session_file,
				cwd = excluded.cwd, name = excluded.name, generation = excluded.generation, source = 'bridge', updated_at = excluded.updated_at`,
		).run(
			session.id,
			session.kind,
			session.spawnedBy ?? null,
			session.file ?? null,
			session.cwd,
			session.name ?? null,
			generation,
			now,
		);
		if (session.program) {
			db.prepare(
				"update program_peers set pid = ?, process_started_at = ?, pane = coalesce(pane, ?) where session_id = ?",
			).run(proc.pid, proc.startedAt, hello.tmux?.pane ?? null, session.id);
		}
		connection.sessionId = session.id;
		connection.generation = generation;
		this.setRunState(session.id, generation, hello.run);
		// The runtime owns the tree once a session is in it: a transfer outlives the flag the session was started with.
		const { reportsTo, ...facts } = hello.facts;
		const stored = db.prepare("select reports_to from sessions where id = ?").get(session.id) as {
			reports_to: string | null;
		};
		this.applyFacts(session.id, generation, stored.reports_to === null && reportsTo ? { ...facts, reportsTo } : facts);
		// A bridge started with a stale flag learns its manager from the record.
		if (stored.reports_to !== null && reportsTo !== undefined && stored.reports_to !== reportsTo)
			this.issue(connection, { kind: "transfer", manager: stored.reports_to, by: "runtime" });
		syncChannels(db, now);
		this.resolveParents();
		// A (re)connecting bridge reports the tool it runs now; one that ended while the bridge was away just clears.
		if (hello.tool) this.startTool(session.id, generation, hello.tool);
		else this.clearTool(session.id, generation);
		// Replay unread deliveries before startup work; a committed retirement's close stays bound to its incarnation.
		const pending = db
			.prepare(
				`select command_id, command from commands where session_id = ? and stage in ('accepted', 'delivered')
					and ((kind = 'mail' and (bound_generation is null or bound_generation = ?))
					or (kind = 'close' and bound_generation = ?)) order by case kind when 'close' then 0 else 1 end, created_at`,
			)
			.all(session.id, generation, generation) as { command_id: string; command: string }[];
		for (const { command_id, command } of pending) {
			const delivery = JSON.parse(command) as Command;
			this.dispatch(connection, command_id, delivery, true);
			if (delivery.kind === "close") break;
		}
		const start = this.starting.get(session.id);
		if (start) {
			this.starting.delete(session.id);
			if (start.prompt) this.issue(connection, { kind: "steer", text: start.prompt });
			this.setCommandStage(start.commandId, "applied");
		}
	}

	/**
	 * Record a client's command and hand it to the target incarnation's bridge. A repeated `commandId` only reports
	 * how far the first one got. Without a live incarnation (or a bound one that is no longer current) it fails at once,
	 * except unbound mail, which waits for the session's next bridge.
	 */
	private command(client: Connection, request: CommandRequest): void {
		const db = this.db!;
		const { commandId, sessionId, generation, command } = request;
		const receipt = (stage: ReceiptStage, reason?: string) =>
			client.socket.write(
				`${JSON.stringify({ type: "receipt", commandId, stage, ...(reason ? { reason } : {}) } satisfies Receipt)}\n`,
			);
		if (typeof commandId !== "string" || typeof sessionId !== "string" || typeof command?.kind !== "string") {
			receipt("failed", "commandId, sessionId, and command.kind are required");
			return;
		}
		if (client.program?.closing) {
			receipt("failed", "The program is closing");
			return;
		}
		const existing = db.prepare("select stage, reason from commands where command_id = ?").get(commandId) as
			| { stage: ReceiptStage; reason: string | null }
			| undefined;
		if (existing) {
			receipt(existing.stage, existing.reason ?? undefined);
			return;
		}
		const current = db.prepare("select generation from sessions where id = ?").get(sessionId) as
			| { generation: number }
			| undefined;
		const target = [...this.connections].find(
			(connection) =>
				!connection.shutdown &&
				connection.sessionId === sessionId &&
				connection.generation === current?.generation &&
				(generation === undefined || generation === current?.generation),
		);
		const waits = !target && command.kind === "mail" && generation === undefined;
		const now = Date.now();
		db.prepare(
			`insert into commands (command_id, session_id, generation, bound_generation, kind, command, stage, created_at, updated_at, program_id)
			values (?, ?, ?, ?, ?, ?, 'accepted', ?, ?, ?)`,
		).run(
			commandId,
			sessionId,
			generation ?? null,
			generation ?? null,
			command.kind,
			JSON.stringify(command),
			now,
			now,
			client.program?.id ?? null,
		);
		this.event("client", sessionId, generation ?? null, "command_accepted", { commandId, command });
		this.commandClients.set(commandId, client);
		if (command.kind === "discard_peer") {
			receipt("accepted");
			this.discardPeer(client, commandId, sessionId);
			return;
		}
		if (command.kind === "start") {
			receipt("accepted");
			this.startSession(commandId, sessionId, command, client.program).catch((error) => {
				console.error(`start ${sessionId} failed: ${(error as Error).stack ?? error}`);
				if (this.db) this.setCommandStage(commandId, "failed", (error as Error).message);
			});
			return;
		}
		if (command.kind === "mark_seen") {
			receipt("accepted");
			if (!current) this.setCommandStage(commandId, "failed", "unknown session");
			else if (generation !== undefined && generation !== current.generation)
				this.setCommandStage(commandId, "failed", "not running");
			else {
				this.seen(sessionId, "command");
				this.setCommandStage(commandId, "applied");
			}
			return;
		}
		if (command.kind === "transfer") {
			receipt("accepted");
			const refused = this.transfer(sessionId, command);
			if (refused) this.setCommandStage(commandId, "failed", refused);
			else {
				this.setCommandStage(commandId, "applied");
				if (target) this.issue(target, { kind: "transfer", manager: command.manager, by: command.by });
			}
			return;
		}
		if (command.kind === "retire") {
			receipt("accepted");
			void this.retireSession(commandId, sessionId, command).catch((error) => {
				if (this.db) this.setCommandStage(commandId, "failed", error instanceof Error ? error.message : String(error));
			});
			return;
		}
		if (command.kind === "set_preference") {
			receipt("accepted");
			if (typeof command.key !== "string" || !command.key || command.value === undefined)
				this.setCommandStage(commandId, "failed", "set_preference needs a key and a value");
			else {
				db.prepare(
					`insert into preferences (key, value, updated_at) values (?, ?, ?)
					on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
				).run(command.key, JSON.stringify(command.value), Date.now());
				this.event("client", null, null, "preference_set", { key: command.key, value: command.value });
				this.setCommandStage(commandId, "applied");
			}
			return;
		}
		if (command.kind === "task_opened" || command.kind === "task_moved") {
			receipt("accepted");
			this.taskLifecycle(commandId, sessionId, command, now);
			return;
		}
		if (command.kind === "work") {
			receipt("accepted");
			this.workCommand(commandId, sessionId, command, now);
			return;
		}
		if (command.kind === "thread_post") {
			receipt("accepted");
			this.threadPost(commandId, sessionId, command, now);
			return;
		}
		if (command.kind === "thread_read") {
			receipt("accepted");
			markRead(db, command.thread, sessionId, command.seq);
			this.setCommandStage(commandId, "applied");
			return;
		}
		if (waits) {
			receipt(
				"accepted",
				current
					? "not running; the mail waits until it opens"
					: "unknown; the mail waits until a session with this id opens",
			);
			return;
		}
		receipt("accepted");
		if (!target) {
			this.setCommandStage(commandId, "failed", "not running");
			return;
		}
		this.dispatch(target, commandId, command);
	}

	/** One transaction per open or close; both are idempotent, so startup replays any that stayed accepted. */
	private taskLifecycle(
		commandId: string,
		sender: string,
		command: Extract<Command, { kind: "task_opened" | "task_moved" }>,
		now: number,
	): void {
		const db = this.db!;
		try {
			db.exec("begin");
			if (command.kind === "task_opened") openLedgerTask(db, sender, command.bundle, now);
			else
				for (const person of closeLedgerTask(db, sender, command.from, command.to, command.status, now))
					this.event("runtime", person, null, "task_moved", { from: command.from, to: command.to });
			db.exec("commit");
		} catch (error) {
			if (db.isTransaction) db.exec("rollback");
			this.setCommandStage(commandId, "failed", (error as Error).message);
			return;
		}
		this.setCommandStage(commandId, "applied");
	}

	private recoverTaskLifecycle(): void {
		const pending = this.db!.prepare(
			"select command_id, session_id, command, created_at from commands where kind in ('task_opened', 'task_moved') and stage = 'accepted'",
		).all() as { command_id: string; session_id: string; command: string; created_at: number }[];
		for (const row of pending)
			this.taskLifecycle(row.command_id, row.session_id, JSON.parse(row.command), row.created_at);
	}

	private workCommand(commandId: string, actor: string, command: WorkCommand, now: number): void {
		if (this.applyWork(commandId, actor, command, now)) this.finishWorkCommand(commandId, actor, command);
	}

	private applyWork(
		commandId: string,
		actor: string,
		command: WorkCommand,
		now: number,
		prepare?: () => void,
	): boolean {
		const db = this.db!;
		const rollback: (() => void)[] = [];
		const committed: (() => void)[] = [];
		let deliveries: ReturnType<Runtime["preparePost"]>;
		this.setCommandStage(commandId, "delivered");
		db.exec("begin");
		try {
			prepare?.();
			const change = changeWork(db, this.paths.dir, commandId, actor, command, now, rollback, committed);
			deliveries = this.preparePost(`${commandId}:post`, actor, change.post, now, {
				person: change.notify,
				goal: change.goal,
			});
			db.exec("commit");
		} catch (error) {
			db.exec("rollback");
			for (const undo of rollback.reverse()) undo();
			this.setCommandStage(commandId, "failed", (error as Error).message);
			return false;
		}
		for (const finish of committed) {
			try {
				finish();
			} catch (error) {
				console.error(`Task committed; source bundle cleanup failed: ${error}`);
			}
		}
		cleanMovedBundles(db);
		for (const { target, id, mail } of deliveries.deliveries) this.dispatch(target, id, mail);
		return true;
	}

	private finishWorkCommand(commandId: string, actor: string, command: WorkCommand): void {
		const db = this.db!;
		if (command.action !== "assign" || !command.person || command.person === actor) {
			this.setCommandStage(commandId, "applied");
			return;
		}
		const live = db
			.prepare(`select 1 from sessions s join incarnations i on i.session_id = s.id and i.generation = s.generation
			where s.id = ? and i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost')`)
			.get(command.person);
		if (live) {
			this.setCommandStage(commandId, "applied");
			return;
		}
		const pane =
			actor === OPERATOR
				? command.tmux
				: (db
						.prepare(`select i.tmux_socket as socket, i.pane_id as pane from incarnations i join sessions s
				on s.id = i.session_id and s.generation = i.generation where s.id = ?`)
						.get(actor) as { socket: string | null; pane: string | null } | undefined);
		if (!pane?.socket || !pane.pane) {
			this.setCommandStage(
				commandId,
				"failed",
				"Assignment saved, but waking this person needs a tmux pane. Call it in to begin.",
			);
			return;
		}
		this.startSession(commandId, command.person, {
			kind: "start",
			tmux: { socket: pane.socket, pane: pane.pane },
			prompt: "You have assigned work. Begin with your focused task.",
		}).catch((error) => {
			if (this.db) this.setCommandStage(commandId, "failed", `Assignment saved; waking failed: ${error}`);
		});
	}

	private recoverWorkCommands(): void {
		const db = this.db!;
		const pending = db
			.prepare(
				"select command_id, session_id, command, created_at, stage from commands where kind = 'work' and stage in ('accepted', 'delivered')",
			)
			.all() as { command_id: string; session_id: string; command: string; created_at: number; stage: string }[];
		for (const row of pending) {
			const command = JSON.parse(row.command) as WorkCommand;
			if (db.prepare("select 1 from work_changes where command_id = ?").get(row.command_id))
				this.finishWorkCommand(row.command_id, row.session_id, command);
			else if (row.stage === "accepted") this.workCommand(row.command_id, row.session_id, command, row.created_at);
			else
				this.setCommandStage(
					row.command_id,
					"failed",
					`Interrupted during task file changes; the assignment change did not commit. Inspect task.md and the ledger index before retrying: ${JSON.stringify(command)}`,
				);
		}
	}

	private async retireSession(
		commandId: string,
		sessionId: string,
		command: Extract<Command, { kind: "retire" }>,
	): Promise<void> {
		const db = this.db!;
		const person = db.prepare("select reports_to, retired_at from sessions where id = ?").get(sessionId) as
			| { reports_to: string | null; retired_at: number | null }
			| undefined;
		if (!person) throw new Error("unknown session");
		if (typeof command.reason !== "string" || !command.reason.trim()) throw new Error("retire needs a reason");
		if (command.by === sessionId)
			throw new Error("Ask your manager or the operator to let you go; your own call cannot wait for you to be idle.");
		if (person.retired_at !== null) {
			this.setCommandStage(commandId, "applied", "This person has already left.");
			return;
		}
		if ([...this.retiring.values()].some((job) => job.person === sessionId))
			throw new Error("This person's handover is already in progress.");
		const controller = new AbortController();
		this.retiring.set(commandId, { person: sessionId, controller });
		const signal = AbortSignal.any([controller.signal, this.stopping.signal]);
		const send = (request: Command, id?: string) =>
			sendCommand(sessionId, request, {
				socketPath: this.paths.socket,
				signal,
				commandId: id,
			});
		try {
			if (![...this.connections].some((connection) => !connection.shutdown && connection.sessionId === sessionId)) {
				const wake = await send({ kind: "start", prompt: "" });
				if (wake.stage === "failed") throw new Error(`Could not wake the person for its handover: ${wake.reason}`);
			}
			signal.throwIfAborted();
			const channel = `team:${person.reports_to ?? sessionId}`;
			const turnId = randomUUID();
			const answer = await send(
				{
					kind: "run_turn",
					task: [
						`Prepare your handover before leaving the organization. Reason: ${command.reason}`,
						`Your final reply will be posted verbatim, in your name, to the team channel ${channel} before you leave.`,
						"Tell the team what is done, what is open, and where the useful context and files are. Say what you verified and what you believe.",
					].join("\n\n"),
				},
				turnId,
			);
			signal.throwIfAborted();
			if (answer.stage !== "applied" || answer.result?.status !== "completed" || !answer.result.text.trim())
				throw new Error(
					`The person has not left: ${answer.reason ?? answer.result?.error ?? "no handover was returned"}`,
				);
			const turn = db.prepare("select generation from commands where command_id = ?").get(turnId) as {
				generation: number;
			};
			const current = db.prepare("select generation, reports_to from sessions where id = ?").get(sessionId) as
				| { generation: number; reports_to: string | null }
				| undefined;
			if (!current || current.generation !== turn.generation || current.reports_to !== person.reports_to)
				throw new Error("The person changed session or team during the handover; it has not been retired.");
			const now = Date.now();
			let pending: ReturnType<Runtime["preparePost"]>;
			let close: Connection | undefined;
			const closeId = `${commandId}:close`;
			db.exec("begin");
			try {
				pending = this.preparePost(
					`${commandId}:handover`,
					sessionId,
					{ thread: channel, body: answer.result.text },
					now,
				);
				db.prepare("update sessions set retired_at = ?, retired_reason = ?, updated_at = ? where id = ?").run(
					now,
					command.reason.trim(),
					now,
					sessionId,
				);
				syncChannels(db, now);
				close = this.queueDelivery(closeId, sessionId, { kind: "close" }, current.generation);
				this.event("client", sessionId, current.generation, "retired", { reason: command.reason });
				db.exec("commit");
			} catch (error) {
				db.exec("rollback");
				throw error;
			}
			for (const { target, id, mail } of pending.deliveries) this.dispatch(target, id, mail);
			this.setCommandStage(commandId, "applied");
			if (close) this.dispatch(close, closeId, { kind: "close" });
		} finally {
			this.retiring.delete(commandId);
		}
	}

	private recoverRetirements(): void {
		const rows = this.db!.prepare(`select c.command_id, m.id as posted, s.retired_at from commands c
			left join thread_messages m on m.id = c.command_id || ':handover'
			left join sessions s on s.id = c.session_id
			where c.kind = 'retire' and c.stage in ('accepted', 'delivered')`).all() as {
			command_id: string;
			posted: string | null;
			retired_at: number | null;
		}[];
		for (const row of rows) {
			if (row.posted && row.retired_at !== null) this.setCommandStage(row.command_id, "applied");
			else
				this.setCommandStage(
					row.command_id,
					"failed",
					"The runtime restarted before the handover and retirement committed; inspect the person before retrying.",
				);
		}
	}

	private preparePost(
		commandId: string,
		sender: string,
		post: ThreadPost,
		now: number,
		changed?: { person: string; goal: boolean },
	) {
		const db = this.db!;
		const posted = postToThread(db, sender, commandId, post, now);
		if (typeof posted === "string") throw new Error(posted);
		const fromName = (
			db.prepare("select name from sessions where id = ?").get(sender) as { name: string | null } | undefined
		)?.name;
		const asleep: string[] = [];
		const deliveries: { target: Connection; id: string; mail: Command }[] = [];
		for (const participant of new Set([...posted.push, ...(changed ? [changed.person] : [])])) {
			if (participant === OPERATOR || participant === sender) continue;
			const mail: Command = {
				kind: "mail",
				from: sender,
				body: post.body,
				sentAt: new Date(now).toISOString(),
				thread: posted.thread,
				subject: posted.subject,
				seq: posted.seq,
				...(fromName ? { fromName } : {}),
				...(changed?.person === participant && changed.goal ? { taskGoal: true } : {}),
			};
			const id = `${commandId}:${participant}`;
			const target = this.queueDelivery(id, participant, mail);
			if (target) deliveries.push({ target, id, mail });
			else
				asleep.push(
					(db.prepare("select name from sessions where id = ?").get(participant) as { name: string | null } | undefined)
						?.name || participant,
				);
		}
		return { asleep, deliveries };
	}

	/** Store a thread message and push it as mail to each pushed participant; the receipt names who is at home. */
	private threadPost(
		commandId: string,
		sessionId: string,
		command: Extract<Command, { kind: "thread_post" }>,
		now: number,
	): void {
		const db = this.db!;
		let pending: ReturnType<Runtime["preparePost"]>;
		db.exec("begin");
		try {
			pending = this.preparePost(commandId, sessionId, command, now);
			db.exec("commit");
		} catch (error) {
			db.exec("rollback");
			this.setCommandStage(commandId, "failed", (error as Error).message);
			return;
		}
		const { deliveries, asleep } = pending;
		for (const { target, id, mail } of deliveries) this.dispatch(target, id, mail);
		this.setCommandStage(
			commandId,
			"applied",
			asleep.length ? `at home, the mail waits: ${asleep.join(", ")}` : undefined,
		);
	}

	/** Complete posts accepted before a crash. A stored message means its full outbox committed with it. */
	private recoverThreadPosts(): void {
		const db = this.db!;
		const pending = db
			.prepare(
				"select command_id, session_id, command, created_at from commands where kind = 'thread_post' and stage = 'accepted'",
			)
			.all() as { command_id: string; session_id: string; command: string; created_at: number }[];
		for (const row of pending) {
			if (db.prepare("select 1 from thread_messages where id = ?").get(row.command_id))
				this.setCommandStage(row.command_id, "applied");
			else this.threadPost(row.command_id, row.session_id, JSON.parse(row.command), row.created_at);
		}
	}

	/** Persist an outgoing delivery in the post's transaction; its bridge is notified only after commit. */
	private queueDelivery(
		commandId: string,
		recipient: string,
		command: Extract<Command, { kind: "mail" | "close" }>,
		generation?: number,
	): Connection | undefined {
		const db = this.db!;
		const current = db.prepare("select generation from sessions where id = ?").get(recipient) as
			| { generation: number }
			| undefined;
		const now = Date.now();
		db.prepare(
			`insert into commands (command_id, session_id, generation, bound_generation, kind, command, stage, created_at, updated_at)
			values (?, ?, ?, ?, ?, ?, 'accepted', ?, ?) on conflict (command_id) do nothing`,
		).run(
			commandId,
			recipient,
			generation ?? null,
			generation ?? null,
			command.kind,
			JSON.stringify(command),
			now,
			now,
		);
		this.event("runtime", recipient, generation ?? null, "command_accepted", { commandId, command });
		const target = [...this.connections].find(
			(connection) =>
				!connection.shutdown &&
				connection.sessionId === recipient &&
				connection.generation === (generation ?? current?.generation),
		);
		return target;
	}

	/**
	 * Move a person under another manager: both must be root sessions of one organization, and the new manager must
	 * not be the person or anyone under it, so the tree stays a tree. Returns the reason a move is refused.
	 */
	private transfer(sessionId: string, command: Extract<Command, { kind: "transfer" }>): string | undefined {
		const db = this.db!;
		if (typeof command.manager !== "string" || !command.manager || typeof command.by !== "string" || !command.by)
			return "transfer needs a manager and the acting manager (by)";
		if (command.manager === sessionId) return "a person cannot report to itself";
		const managerOf = new Map(
			(
				db.prepare("select id, reports_to from sessions where kind = 'root'").all() as {
					id: string;
					reports_to: string | null;
				}[]
			).map((row) => [row.id, row.reports_to]),
		);
		if (!managerOf.has(sessionId)) return "unknown session";
		if (!managerOf.has(command.manager)) return `unknown manager ${command.manager}`;
		const rootOf = (id: string) => {
			const seen = new Set<string>();
			let current = id;
			while (!seen.has(current)) {
				seen.add(current);
				const manager = managerOf.get(current);
				if (!manager || !managerOf.has(manager)) return current;
				current = manager;
			}
			return current;
		};
		const root = rootOf(sessionId);
		if (rootOf(command.manager) !== root || rootOf(command.by) !== root)
			return `${command.manager} is not in ${sessionId}'s organization`;
		for (let id: string | null | undefined = command.manager; id; id = managerOf.get(id))
			if (id === sessionId)
				return `${command.manager} reports to ${sessionId}; a manager cannot report to its own report`;
		const from = managerOf.get(sessionId) ?? null;
		if (from === command.manager) return `already reports to ${command.manager}`;
		const now = Date.now();
		db.prepare("update sessions set reports_to = ?, updated_at = ? where id = ?").run(command.manager, now, sessionId);
		db.prepare("insert into manager_changes (session_id, from_manager, to_manager, by, at) values (?, ?, ?, ?, ?)").run(
			sessionId,
			from,
			command.manager,
			command.by,
			now,
		);
		syncChannels(db, now);
		this.event("client", sessionId, null, "transferred", { from, to: command.manager, by: command.by });
		return undefined;
	}

	private discardPeer(client: Connection, commandId: string, sessionId: string): void {
		const row = this.db!.prepare("select program_id from program_peers where session_id = ?").get(sessionId) as
			| { program_id: string }
			| undefined;
		if (!client.program || (row?.program_id !== client.program.id && !client.program.created.has(sessionId))) {
			this.setCommandStage(commandId, "failed", "This program does not own that peer");
			return;
		}
		this.discardRequests.set(commandId, this.markDiscarded([sessionId]));
		void this.cleanPrograms();
	}

	private openProgram(connection: Connection, request: Extract<BridgeMessage, { type: "program_open" }>): void {
		const db = this.db!;
		const caller = db
			.prepare("select 1 from sessions where id = ? and kind = 'root' and retired_at is null")
			.get(request.caller);
		if (
			connection.program ||
			!request.id?.trim() ||
			db.prepare("select 1 from program_scopes where id = ?").get(request.id) ||
			!caller ||
			this.discarding.has(request.caller)
		) {
			connection.socket.end(
				`${JSON.stringify({ type: "program_error", error: "A program needs a unique id and an available calling person" })}\n`,
			);
			return;
		}
		const parent = (
			db.prepare("select program_id from program_peers where session_id = ?").get(request.caller) as
				| { program_id: string }
				| undefined
		)?.program_id;
		db.prepare("insert into program_scopes (id, caller, parent) values (?, ?, ?)").run(
			request.id,
			request.caller,
			parent ?? null,
		);
		connection.program = {
			id: request.id,
			caller: request.caller,
			closing: false,
			created: new Set(),
			discarded: new Set(),
		};
		this.programs.set(request.id, connection);
		connection.socket.write(`${JSON.stringify({ type: "program_ready", id: request.id })}\n`);
	}

	private programTurns(connection: Connection): string[] {
		return (
			this.db!.prepare(
				"select command_id from commands where program_id = ? and kind = 'run_turn' and stage in ('accepted', 'delivered')",
			).all(connection.program!.id) as { command_id: string }[]
		).map((row) => row.command_id);
	}

	private cancelProgramTurns(connection: Connection): void {
		for (const id of this.programTurns(connection)) {
			const target = this.dispatched.get(id);
			if (target) this.issue(target, { kind: "cancel_turn", turn: id });
		}
	}

	private closeProgram(connection: Connection): void {
		const program = connection.program;
		if (!program || !this.db) return;
		if (!program.closing) this.cancelProgramTurns(connection);
		program.closing = true;
		this.db.prepare("update program_scopes set closing = 1 where id = ?").run(program.id);
		const ids = this.markDiscarded(
			(
				this.db.prepare("select session_id from program_peers where program_id = ?").all(program.id) as {
					session_id: string;
				}[]
			).map((row) => row.session_id),
		);
		for (const id of ids) program.discarded.add(id);
		void this.cleanPrograms();
	}

	private markDiscarded(roots: Iterable<string>): Set<string> {
		if (!this.db) return new Set();
		const ids = programDescendants(this.db, roots);
		for (const id of ids) {
			this.discarding.add(id);
			this.db.prepare("update program_scopes set closing = 1 where caller = ?").run(id);
		}
		for (const connection of this.programs.values()) {
			const program = connection.program!;
			for (const id of ids)
				if (program.created.has(id))
					for (const child of programDescendants(this.db, [id])) program.discarded.add(child);
			if (ids.has(program.caller) && !program.closing) {
				this.cancelProgramTurns(connection);
				program.closing = true;
			}
		}
		return ids;
	}

	/** A program may end between process creation and hello, so the launch record is independent of incarnations. */
	private async stopProgramPeer(
		id: string,
		db: DatabaseSync,
		servers: Map<string, PaneRow[] | "absent">,
	): Promise<boolean> {
		const launch = db.prepare("select * from program_peers where session_id = ?").get(id) as
			| { socket: string | null; pane: string | null; pid: number | null; process_started_at: number | null }
			| undefined;
		if (!launch) return true;
		let pane: PaneRow | undefined;
		const isLaunch = (p: PaneRow) => p.windowName === id || p.startCommand.includes(`--session-id ${id} `);
		if (launch.socket) {
			if (this.starting.has(id) && !launch.pane) return false;
			if (!servers.has(launch.socket))
				servers.set(
					launch.socket,
					await listPanes(launch.socket, { timeout: TMUX_POLL_MS, signal: this.stopping.signal }),
				);
			if (this.db !== db) return false;
			const panes = servers.get(launch.socket)!;
			if (panes !== "absent") pane = panes.find((p) => (launch.pane ? p.paneId === launch.pane : isLaunch(p)));
			if (pane && launch.pid === null && !pane.dead) {
				// The initial command survives a window rename before the daemon records the pane or receives hello.
				const started = processStart(pane.pid);
				if (started === "gone") return false;
				if (started === "unknown") throw new Error(`Cannot identify the process in temporary peer ${id}'s pane`);
				launch.pid = pane.pid;
				launch.process_started_at = started;
				launch.pane = pane.paneId;
				db.prepare("update program_peers set pane = ?, pid = ?, process_started_at = ? where session_id = ?").run(
					pane.paneId,
					pane.pid,
					started,
					id,
				);
			}
		}
		const processes = db.prepare("select pid, process_started_at from incarnations where session_id = ?").all(id) as {
			pid: number;
			process_started_at: number;
		}[];
		if (launch.pid !== null && launch.process_started_at !== null)
			processes.push({ pid: launch.pid, process_started_at: launch.process_started_at });
		let waiting = this.headless.has(id);
		for (const proc of processes) {
			const state = checkProcess(proc.pid, proc.process_started_at);
			if (state === "gone") continue;
			waiting = true;
			if (state === "unknown") throw new Error(`Cannot verify process ${proc.pid} of temporary peer ${id}`);
			const key = `${proc.pid}:${proc.process_started_at}`;
			let sent = this.signalled.get(id);
			if (!sent) {
				sent = new Set();
				this.signalled.set(id, sent);
			}
			if (!sent.has(key)) {
				try {
					process.kill(proc.pid, "SIGTERM");
				} catch (error) {
					if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
				}
				sent.add(key);
			}
		}
		if (waiting) return false;
		// Remove a dead program pane too (servers may keep exited panes); leave a pane the operator respawned.
		if (pane && (pane.pid === launch.pid || (launch.pid === null && isLaunch(pane)))) {
			await killPane(
				launch.socket!,
				pane.paneId,
				AbortSignal.any([this.stopping.signal, AbortSignal.timeout(TMUX_POLL_MS)]),
			);
			if (this.db !== db) return false;
		}
		const start = this.starting.get(id);
		if (start) {
			this.starting.delete(id);
			this.setCommandStage(start.commandId, "failed", "The program discarded the peer before it connected");
		}
		return true;
	}

	private async cleanPrograms(): Promise<void> {
		const db = this.db;
		if (!db || this.cleaningPrograms) return;
		clearTimeout(this.programTimer);
		this.programTimer = undefined;
		this.cleaningPrograms = true;
		try {
			this.markDiscarded(this.discarding);
			const stopped = new Set<string>();
			const servers = new Map<string, PaneRow[] | "absent">();
			for (const id of this.discarding) if (await this.stopProgramPeer(id, db, servers)) stopped.add(id);
			if (this.db !== db) return;
			if (stopped.size) {
				for (const id of stopped) {
					if (!db.prepare("select 1 from program_peers where session_id = ?").get(id)) continue;
					const pending = db
						.prepare(
							"select command_id from commands where session_id = ? and kind != 'discard_peer' and stage in ('accepted', 'delivered')",
						)
						.all(id) as { command_id: string }[];
					for (const row of pending) this.setCommandStage(row.command_id, "failed", "The temporary peer was discarded");
				}
				const transfers = discardProgramPeople(db, this.paths.dir, stopped, Date.now());
				for (const { person, manager } of transfers) {
					const generation = (
						db.prepare("select generation from sessions where id = ?").get(person) as { generation: number }
					).generation;
					const target = [...this.connections].find(
						(c) => !c.shutdown && c.sessionId === person && c.generation === generation,
					);
					if (target) this.issue(target, { kind: "transfer", manager, by: "runtime" });
				}
				for (const id of stopped) {
					this.discarding.delete(id);
					this.signalled.delete(id);
				}
			}
			for (const [command, people] of this.discardRequests) {
				if ([...people].some((person) => this.discarding.has(person))) continue;
				this.setCommandStage(command, "applied");
				this.discardRequests.delete(command);
			}
			this.finishClosedPrograms(db);
		} catch (error) {
			if (this.db !== db) return;
			console.error(`Program cleanup failed: ${error instanceof Error ? error.message : String(error)}`);
			db.prepare("update program_scopes set last_error = ? where closing = 1").run(String(error));
			for (const command of this.discardRequests.keys()) this.setCommandStage(command, "failed", String(error));
			this.discardRequests.clear();
			for (const [id, connection] of this.programs) {
				if (!connection.program!.closing) continue;
				this.programs.delete(id);
				connection.socket.end(`${JSON.stringify({ type: "program_error", error: String(error) })}\n`);
			}
		} finally {
			this.cleaningPrograms = false;
			if (this.db && this.discarding.size) this.programTimer = setTimeout(() => void this.cleanPrograms(), RETRY_MS);
		}
	}

	private finishClosedPrograms(db: DatabaseSync): void {
		for (;;) {
			const leaves = db
				.prepare(`select s.id from program_scopes s where s.closing = 1
				and not exists (select 1 from program_peers p where p.program_id = s.id)
				and not exists (select 1 from program_scopes c where c.parent = s.id)
				and not exists (select 1 from commands c where c.program_id = s.id and c.kind = 'run_turn' and c.stage in ('accepted', 'delivered'))`)
				.all() as { id: string }[];
			let closed = false;
			for (const { id } of leaves) {
				const connection = this.programs.get(id);
				if ([...(connection?.program?.discarded ?? [])].some((person) => this.discarding.has(person))) continue;
				db.prepare("delete from program_scopes where id = ?").run(id);
				this.programs.delete(id);
				connection?.socket.end(`${JSON.stringify({ type: "program_closed", id })}\n`);
				closed = true;
			}
			if (!closed) return;
		}
	}

	/** Queued in the new person's assignment transaction, before its first bridge or model turn. */
	private queueTeamHistory(commandId: string, person: string, manager: string | undefined): void {
		const db = this.db!;
		syncChannels(db, Date.now());
		if (!manager) return;
		const channel = `team:${manager}`;
		const history = messagesOf(db, channel);
		if (history.length === 0) return;
		this.queueDelivery(`${commandId}:team-history`, person, {
			kind: "mail",
			from: manager,
			fromName: nameOf(db, manager),
			sentAt: new Date().toISOString(),
			thread: channel,
			subject: threadOf(db, channel)!.subject,
			seq: history.at(-1)!.seq,
			body: `Team context at your arrival, from ${channel}. Use read_thread to catch up later.\n\n${history
				.map(
					(message) => `${message.fromName} (${message.from}), ${new Date(message.at).toISOString()}:\n${message.body}`,
				)
				.join("\n\n")}`,
		});
	}

	/** The bridge connecting applies a launch, whether it opened a terminal or a headless RPC process. */
	private async startSession(
		commandId: string,
		sessionId: string,
		command: Extract<Command, { kind: "start" }>,
		program?: Connection["program"],
	) {
		const db = this.db!;
		const fail = (reason: string) => this.setCommandStage(commandId, "failed", reason);
		const row = db
			.prepare("select cwd, name, generation, reports_to, role from sessions where id = ?")
			.get(sessionId) as
			| { cwd: string; name: string | null; generation: number; reports_to: string | null; role: string | null }
			| undefined;
		const live =
			row &&
			db
				.prepare(
					"select 1 from incarnations where session_id = ? and generation = ? and ended_at is null and process_state in ('alive', 'alive_bridge_lost')",
				)
				.get(sessionId, row.generation);
		if (live) return fail("already running");
		if (this.starting.has(sessionId)) return fail("already starting");
		if (program?.discarded.has(sessionId)) return fail("That peer was discarded; create a new handle");
		if (db.prepare("select 1 from program_peers where session_id = ?").get(sessionId))
			return fail("Program peers cannot be reopened; create a new handle");
		if (program) {
			if (row) return fail("A program must create a new peer, not take ownership of an existing person");
			if (!command.role || !command.goal?.text.trim()) return fail("A program peer needs a role and a goal");
			const caller = db
				.prepare(`select s.cwd, i.tmux_socket, i.pane_id from sessions s
				left join incarnations i on i.session_id = s.id and i.generation = s.generation where s.id = ?`)
				.get(program.caller) as { cwd: string; tmux_socket: string | null; pane_id: string | null } | undefined;
			if (!caller) return fail("The calling person no longer exists");
			program.created.add(sessionId);
			command = {
				...command,
				cwd: caller.cwd,
				reportsTo: program.caller,
				prompt: "",
				goal: { by: program.caller, text: command.goal.text },
				tmux: caller.tmux_socket && caller.pane_id ? { socket: caller.tmux_socket, pane: caller.pane_id } : undefined,
			};
		}
		const directory = command.cwd ?? row?.cwd;
		if (!directory) return fail("unknown session; give a directory to start it in");
		const cwd = realpathSync(directory);
		if (!row && command.role && !command.goal?.text.trim()) return fail("A new hire needs a written goal");
		const name = command.name ?? row?.name ?? undefined;
		// A stopped person keeps its manager; a reopen by a manager is a return from retirement.
		const reportsTo = row?.reports_to ?? command.reportsTo;
		const inherited =
			!row && reportsTo
				? (
						db.prepare("select program_id from program_peers where session_id = ?").get(reportsTo) as
							| { program_id: string }
							| undefined
					)?.program_id
				: undefined;
		const programId = program?.id ?? inherited;
		const programParent = programId ? reportsTo : undefined;
		if (
			programId &&
			(!this.programs.has(programId) ||
				this.programs.get(programId)!.program!.closing ||
				!programParent ||
				this.discarding.has(programParent))
		)
			return fail("The owning program is closing");
		if (programId) {
			if (!command.role || !command.goal?.text.trim()) return fail("A program peer needs a role and a goal");
			this.programs.get(programId)!.program!.created.add(sessionId);
			db.prepare(
				"insert into program_peers (session_id, program_id, created_by, task_id, socket) values (?, ?, ?, ?, ?)",
			).run(
				sessionId,
				programId,
				programParent!,
				`work-${commandId}`,
				command.tmux ? canonicalSocket(command.tmux.socket) : null,
			);
		}
		if (row) db.prepare("update sessions set retired_at = null, retired_reason = null where id = ?").run(sessionId);
		if (command.goal) {
			const prepare = () => {
				if (!row) {
					db.prepare(`insert into sessions (id, kind, cwd, name, run_state, generation, reports_to, role, source, updated_at)
					values (?, 'root', ?, ?, 'idle', 0, ?, ?, 'runtime', ?)`).run(
						sessionId,
						cwd,
						name ?? null,
						reportsTo ?? null,
						command.role ?? null,
						Date.now(),
					);
					this.queueTeamHistory(commandId, sessionId, reportsTo);
				}
			};
			if (
				!this.applyWork(
					commandId,
					command.goal.by,
					{
						kind: "work",
						action: "assign",
						person: sessionId,
						goal: command.goal.text,
						...(command.goal.title ? { title: command.goal.title } : {}),
						cwd,
					},
					Date.now(),
					prepare,
				)
			)
				return;
		}
		return this.launchSession(commandId, sessionId, {
			cwd,
			name,
			reportsTo,
			role: row?.role ?? command.role,
			prompt:
				command.prompt ??
				(focusedTask(db, sessionId) ? "You have assigned work. Begin with your focused task." : undefined),
			tmux: command.tmux,
			...(programId ? { program: { id: programId, parent: programParent! } } : {}),
		});
	}

	private async launchSession(commandId: string, sessionId: string, launch: SessionLaunch): Promise<void> {
		const db = this.db!;
		const fail = (reason: string) => this.setCommandStage(commandId, "failed", reason);
		const { cwd, name, reportsTo, role, prompt } = launch;
		const programId = launch.program?.id;
		const programParent = launch.program?.parent;
		const pi = [
			"pi",
			...(!launch.tmux ? ["--mode", "rpc"] : []),
			"--session-id",
			sessionId,
			...(name ? ["--name", name] : []),
			...(reportsTo ? ["--reports-to", reportsTo] : []),
			...(role ? ["--role", role] : []),
		];
		const env = { [PROGRAM_ID_ENV]: programId ?? "", [PROGRAM_PARENT_ENV]: programParent ?? "" };
		const start: SessionStart = {
			commandId,
			prompt,
			...(launch.tmux ? { socket: canonicalSocket(launch.tmux.socket) } : {}),
		};
		this.starting.set(sessionId, start); // the bridge may connect before the launch returns
		if (!launch.tmux) {
			const startedAt = Date.now();
			const child = spawn(pi[0]!, pi.slice(1), {
				cwd,
				env: { ...process.env, ...env, TMUX: "", TMUX_PANE: "" },
				stdio: ["pipe", "ignore", "inherit"],
				detached: process.platform !== "win32",
			});
			this.headless.set(sessionId, child);
			if (programId && child.pid)
				db.prepare("update program_peers set pid = ?, process_started_at = ? where session_id = ?").run(
					child.pid,
					startedAt,
					sessionId,
				);
			child.once("error", (error) => {
				if (this.db === db) fail(`Pi could not start: ${error.message}`);
			});
			child.once("close", (code) => {
				if (this.headless.get(sessionId) === child) this.headless.delete(sessionId);
				if (this.db !== db) return;
				if (this.starting.get(sessionId) === start) {
					this.starting.delete(sessionId);
					fail(`Pi exited before connecting (code ${code}); see the runtime log`);
				}
				void this.cleanPrograms();
			});
			this.setCommandStage(commandId, "delivered");
			return;
		}
		try {
			start.pane = await openWindow(
				launch.tmux.socket,
				launch.tmux.pane,
				{ cwd, name: programId ? sessionId : name, command: pi, env },
				AbortSignal.any([this.stopping.signal, AbortSignal.timeout(TMUX_POLL_MS)]),
			);
		} catch (error) {
			if (this.starting.get(sessionId) === start) this.starting.delete(sessionId);
			const { stderr, message } = error as { stderr?: string; message: string };
			if (this.db === db) fail(`tmux could not open a window: ${stderr?.trim() || message}`);
			return;
		}
		if (this.db === db) {
			if (programId) db.prepare("update program_peers set pane = ? where session_id = ?").run(start.pane, sessionId);
			if (this.starting.get(sessionId) === start) this.setCommandStage(commandId, "delivered");
			if (this.discarding.has(sessionId)) void this.cleanPrograms();
		}
	}

	/** A command of the runtime's own to a running bridge, recorded like a client's but with nobody waiting on it. */
	private issue(target: Connection, command: Command): void {
		const commandId = randomUUID();
		const now = Date.now();
		this.db!.prepare(
			`insert into commands (command_id, session_id, generation, bound_generation, kind, command, stage, created_at, updated_at)
			values (?, ?, ?, ?, ?, ?, 'accepted', ?, ?)`,
		).run(
			commandId,
			target.sessionId!,
			target.generation!,
			target.generation!,
			command.kind,
			JSON.stringify(command),
			now,
			now,
		);
		this.dispatch(target, commandId, command);
	}

	/** Hand a command to a bridge, binding it to that bridge's incarnation; only that incarnation may report on it. */
	private dispatch(target: Connection, commandId: string, command: Command, replay = false): void {
		this.db!.prepare("update commands set generation = ? where command_id = ?").run(target.generation!, commandId);
		this.dispatched.set(commandId, target);
		target.socket.write(`${JSON.stringify({ type: "command", commandId, command, ...(replay ? { replay } : {}) })}\n`);
	}

	/**
	 * A closed connection gets no more receipts. Commands handed to a bridge that went away fail, since nobody can say
	 * whether they were applied; mail stays, and the session's next bridge gets it again.
	 */
	private dropCommandsOf(connection: Connection): void {
		for (const [commandId, client] of this.commandClients) {
			if (client !== connection) continue;
			const target = this.dispatched.get(commandId);
			const row = this.db?.prepare("select kind from commands where command_id = ?").get(commandId) as
				| { kind: string }
				| undefined;
			if (target && row?.kind === "run_turn") this.issue(target, { kind: "cancel_turn", turn: commandId });
			this.retiring.get(commandId)?.controller.abort(new Error("The retirement request was cancelled."));
			this.commandClients.delete(commandId);
		}
		for (const [commandId, target] of this.dispatched) {
			if (target !== connection) continue;
			this.dispatched.delete(commandId);
			const row = this.db?.prepare("select kind, bound_generation from commands where command_id = ?").get(commandId) as
				| { kind: string; bound_generation: number | null }
				| undefined;
			if (row && (row.kind !== "mail" || row.bound_generation !== null))
				this.setCommandStage(
					commandId,
					"failed",
					"the session's bridge disconnected; it may or may not have applied it",
				);
		}
	}

	/** A slow program reader retains only the latest snapshot per run, never a growing stream of snapshots. */
	private turnProgress(client: Connection, message: Extract<BridgeMessage, { type: "turn_progress" }>): void {
		if (client.socket.destroyed || this.commandClients.get(message.commandId) !== client) return;
		if (client.socket.writableNeedDrain) {
			client.heldTurns ??= new Map();
			client.heldTurns.set(message.commandId, message);
			if (!client.turnsAwaitingDrain) {
				client.turnsAwaitingDrain = true;
				client.socket.once("drain", () => {
					client.turnsAwaitingDrain = false;
					const held = [...(client.heldTurns?.values() ?? [])];
					client.heldTurns?.clear();
					for (const value of held) this.turnProgress(client, value);
				});
			}
			return;
		}
		client.socket.write(`${JSON.stringify(message)}\n`);
	}

	/** A bridge reports progress only for commands handed to its own incarnation. */
	private commandProgress(
		bridge: Connection,
		commandId: string,
		stage: ReceiptStage,
		reason?: string,
		result?: TurnResult,
	): void {
		const row = this.db!.prepare("select session_id, generation from commands where command_id = ?").get(commandId) as
			| { session_id: string; generation: number | null }
			| undefined;
		if (!row || row.session_id !== bridge.sessionId || row.generation !== bridge.generation) return;
		this.setCommandStage(commandId, stage, reason, result);
	}

	private setCommandStage(commandId: string, stage: ReceiptStage, reason?: string, result?: TurnResult): void {
		const db = this.db!;
		const row = db
			.prepare("select session_id, generation, stage, kind, command, program_id from commands where command_id = ?")
			.get(commandId) as
			| {
					session_id: string;
					generation: number | null;
					stage: ReceiptStage;
					kind: string;
					command: string;
					program_id: string | null;
			  }
			| undefined;
		if (!row || row.stage === "applied" || row.stage === "failed") return;
		// Mail of a thread that reached the transcript has been read there.
		if (stage === "applied" && row.kind === "mail") {
			const mail = JSON.parse(row.command) as { thread?: string; seq?: number };
			if (mail.thread && typeof mail.seq === "number") markRead(db, mail.thread, row.session_id, mail.seq);
		}
		db.prepare("update commands set stage = ?, reason = ?, updated_at = ? where command_id = ?").run(
			stage,
			reason ?? null,
			Date.now(),
			commandId,
		);
		this.event("runtime", row.session_id, row.generation, `command_${stage}`, {
			commandId,
			...(reason ? { reason } : {}),
		});
		const client = this.commandClients.get(commandId);
		if (stage === "applied" || stage === "failed") client?.heldTurns?.delete(commandId);
		client?.socket.write(
			`${JSON.stringify({ type: "receipt", commandId, stage, ...(reason ? { reason } : {}), ...(result ? { result } : {}) } satisfies Receipt)}\n`,
		);
		if (stage === "applied" || stage === "failed") {
			this.commandClients.delete(commandId);
			this.dispatched.delete(commandId);
			if (row.program_id) void this.cleanPrograms();
		}
	}

	/**
	 * A bridge reconnecting to an open incarnation that had no live connection was unheard for a while (the runtime
	 * or the bridge was down). What happened then is lost: record the gap, from the last thing recorded, instead of
	 * inventing events. The hello's snapshot then brings current state back.
	 */
	private recordGap(connection: Connection, sessionId: string, generation: number): void {
		for (const other of this.connections)
			if (other !== connection && !other.shutdown && other.sessionId === sessionId && other.generation === generation)
				return;
		// From the last thing the bridge itself reported: the runtime's own liveness checks after a restart are not
		// observations of the session, and starting there would hide the outage.
		const { since } = this.db!.prepare(
			"select max(at) as since from events where session_id = ? and generation = ? and source = 'bridge'",
		).get(sessionId, generation) as { since: number | null };
		this.event("runtime", sessionId, generation, "gap", { since, until: Date.now() });
	}

	/** Completed conversation, indexed once: a row already present is ignored, a new one is also an event. */
	private index(sessionId: string, generation: number, rows: IndexRow[]): void {
		const db = this.db!;
		const insert = db.prepare(
			`insert or ignore into messages (session_id, entry_id, part, at, role, tool, size, preview, source, observed_at)
			values (?, ?, ?, ?, ?, ?, ?, ?, 'bridge', ?)`,
		);
		const now = Date.now();
		db.exec("begin");
		try {
			for (const row of rows) {
				const added = insert.run(
					sessionId,
					row.entryId,
					row.part,
					row.at,
					row.role,
					row.tool ?? null,
					row.size,
					row.preview,
					now,
				);
				if (added.changes)
					this.event("bridge", sessionId, generation, "message", {
						entryId: row.entryId,
						part: row.part,
						role: row.role,
					});
			}
			db.exec("commit");
		} catch (error) {
			db.exec("rollback");
			throw error;
		}
	}

	/** One entry of a session's transcript, read from Pi's own JSONL file, which stays the source of truth. */
	private async readEntry(connection: Connection, request: ReadEntry): Promise<void> {
		const reply = (body: { entry: unknown } | { error: string }) =>
			connection.socket.write(
				`${JSON.stringify({ type: "entry", requestId: request.requestId, ...body } as EntryReply)}\n`,
			);
		if (typeof request.sessionId !== "string" || typeof request.entryId !== "string")
			return void reply({ error: "sessionId and entryId must be strings" });
		const row = this.db?.prepare("select session_file from sessions where id = ?").get(request.sessionId) as
			| { session_file: string | null }
			| undefined;
		if (!row) return void reply({ error: "unknown session" });
		if (!row.session_file) return void reply({ error: "session has no transcript file" });
		let found: Map<string, unknown>;
		try {
			found = await scanTranscript(row.session_file, new Set([request.entryId]));
		} catch (error) {
			return void reply({ error: `cannot read transcript: ${(error as Error).message}` });
		}
		if (found.has(request.entryId)) return void reply({ entry: found.get(request.entryId) });
		reply({ error: "entry not found" });
	}

	/**
	 * Send a stream message to every subscriber without ever waiting on one. A client whose socket needs draining gets
	 * nothing more written until it drains; meanwhile, per session, its deltas are coalesced into one and only the last
	 * end is kept. When a newer stream starts, the older stream's held text is dropped (its end, if any, stays), so what
	 * is held per session is at most one reply's text and one end.
	 */
	private relay(message: ReplyDelta | ReplyEnd): void {
		for (const client of this.connections) {
			if (!client.subscriptions?.has(message.sessionId)) continue;
			if (!client.held && !client.socket.writableNeedDrain) {
				client.socket.write(`${JSON.stringify(message)}\n`);
				continue;
			}
			if (!client.held) {
				client.held = new Map();
				client.socket.once("drain", () => this.flushHeld(client));
			}
			const held = client.held.get(message.sessionId) ?? {};
			client.held.set(message.sessionId, held);
			if (message.type === "reply_end") {
				held.end = message; // it also ends every earlier stream of the session
				if (held.delta && held.delta.streamId !== message.streamId) held.delta = undefined;
			} else if (held.delta?.streamId === message.streamId)
				held.delta = { ...held.delta, seq: message.seq, delta: held.delta.delta + message.delta };
			else held.delta = message;
		}
	}

	/** Write what a client's drained socket was held back from, in stream order. */
	private flushHeld(client: Connection): void {
		const held = client.held;
		client.held = undefined;
		if (!held || client.socket.destroyed) return;
		const write = (message: ReplyDelta | ReplyEnd | undefined) =>
			message && client.socket.write(`${JSON.stringify(message)}\n`);
		for (const { end, delta } of held.values()) {
			// An end of the held stream comes after its text; an end of an older stream comes first.
			if (end && delta?.streamId === end.streamId) {
				write(delta);
				write(end);
			} else {
				write(end);
				write(delta);
			}
		}
	}

	/** A page of a session's entries, in the order its `messages` index holds them, newest page first. */
	private async readEntries(connection: Connection, request: ReadEntries): Promise<void> {
		const reply = (body: Omit<EntriesReply, "type" | "requestId">) =>
			connection.socket.write(
				`${JSON.stringify({ type: "entries", requestId: request.requestId, ...body } as EntriesReply)}\n`,
			);
		const db = this.db;
		if (!db) return;
		const row = db.prepare("select session_file from sessions where id = ?").get(request.sessionId) as
			| { session_file: string | null }
			| undefined;
		if (!row) return void reply({ error: "unknown session" });
		if (!row.session_file) return void reply({ error: "session has no transcript file" });
		const limit = Number.isInteger(request.limit) && request.limit! > 0 ? request.limit! : 50;
		const ids = (
			db
				.prepare("select entry_id from messages where session_id = ? and part = '' order by at, rowid")
				.all(request.sessionId) as { entry_id: string }[]
		).map((r) => r.entry_id);
		const end = request.before === undefined ? ids.length : ids.indexOf(request.before);
		if (end < 0) return void reply({ error: "unknown cursor" });
		const start = Math.max(0, end - limit);
		const page = ids.slice(start, end);
		// One read of the transcript per page, however many entries it holds.
		let found: Map<string, unknown>;
		try {
			found = await scanTranscript(row.session_file, new Set(page));
		} catch (error) {
			return void reply({ error: `cannot read transcript: ${(error as Error).message}` });
		}
		const missing = page.filter((id) => !found.has(id));
		reply({
			entries: page.filter((id) => found.has(id)).map((id) => found.get(id)),
			before: start > 0 ? ids[start] : null,
			...(missing.length ? { missing } : {}),
		});
	}

	/**
	 * A forked or cloned session names its parent by file, and a session that followed another in the same process
	 * names that one by file; resolve each to a session id once that session is known.
	 */
	private resolveParents(): void {
		this.db!.exec(
			`update sessions set parent_session_id = (
				select parent.id from sessions parent where parent.session_file = sessions.parent_session_file
			) where parent_session_file is not null and parent_session_id is null;
			update sessions set previous_session_id = (
				select previous.id from sessions previous where previous.session_file = json_extract(sessions.previous_session, '$.file')
			) where previous_session is not null and previous_session_id is null`,
		);
	}

	/** The current generation's facts, each change an event of its own. */
	private applyFacts(sessionId: string, generation: number, facts: Partial<Facts>): void {
		const db = this.db!;
		const row = db.prepare("select * from sessions where id = ?").get(sessionId) as Record<string, unknown> | undefined;
		if (!row || row.generation !== generation) return;
		for (const [key, value] of Object.entries(facts)) {
			const column = FACT_COLUMNS[key as keyof Facts];
			if (!column) continue;
			const stored =
				JSON_FACTS.has(key) && value !== null
					? JSON.stringify(value)
					: typeof value === "boolean"
						? Number(value)
						: (value as string | number | null);
			if (row[column] === stored) continue;
			db.prepare(`update sessions set ${column} = ?, source = 'bridge', updated_at = ? where id = ?`).run(
				stored,
				Date.now(),
				sessionId,
			);
			const before =
				JSON_FACTS.has(key) && typeof row[column] === "string" ? JSON.parse(row[column] as string) : row[column];
			// A changed parent or predecessor file needs resolving to a session id again.
			if (key === "parentSessionFile")
				db.prepare("update sessions set parent_session_id = null where id = ?").run(sessionId);
			if (key === "previousSession")
				db.prepare("update sessions set previous_session_id = null where id = ?").run(sessionId);
			// An open prompt needs the operator; once it closes, only a settle they have not seen still does. Rows left by
			// older child sessions never need them.
			if (key === "prompt" && value)
				db.prepare(
					"update sessions set needs_you_since = coalesce(needs_you_since, ?) where id = ? and kind = 'root'",
				).run(Date.now(), sessionId);
			else if (key === "prompt")
				db.prepare(
					"update sessions set needs_you_since = case when coalesce(settled_at, 0) > coalesce(seen_at, 0) then needs_you_since end where id = ?",
				).run(sessionId);
			const type = key === "prompt" ? (value ? "prompt_opened" : "prompt_closed") : `${column}_changed`;
			this.event("bridge", sessionId, generation, type, { from: before, to: value });
		}
		// The name has its own column, which a rename must change too.
		if (facts.config && facts.config.name !== row.name)
			db.prepare("update sessions set name = ? where id = ?").run(facts.config.name, sessionId);
		if (
			(facts.reportsTo !== undefined && facts.reportsTo !== row.reports_to) ||
			(facts.manages !== undefined && (facts.manages === null ? null : Number(facts.manages)) !== row.manages) ||
			(facts.config && facts.config.name !== row.name)
		)
			syncChannels(db, Date.now());
	}

	private isCurrent(sessionId: string, generation: number): boolean {
		const row = this.db!.prepare("select generation from sessions where id = ?").get(sessionId) as
			| { generation: number }
			| undefined;
		return row?.generation === generation;
	}

	/** Show `tool` as the session's current tool, without an event: it already started. */
	private showTool(sessionId: string, tool: Tool): void {
		this.db!.prepare(
			`update sessions set current_tool = ?, current_tool_id = ?, current_tool_arg = ?, current_tool_since = ?,
			source = 'bridge', updated_at = ? where id = ?`,
		).run(tool.name, tool.id, tool.arg ?? null, tool.since, Date.now(), sessionId);
	}

	private startTool(sessionId: string, generation: number, tool: Tool): void {
		const row = this.db!.prepare("select generation, current_tool_id from sessions where id = ?").get(sessionId) as
			| { generation: number; current_tool_id: string | null }
			| undefined;
		if (!row || row.generation !== generation || row.current_tool_id === tool.id) return;
		this.showTool(sessionId, tool);
		this.event("bridge", sessionId, generation, "tool_started", {
			id: tool.id,
			name: tool.name,
			arg: tool.arg ?? null,
		});
	}

	/** Clear the current tool (only `id`, when given); true when a tool was cleared. */
	private clearTool(sessionId: string, generation: number, id?: string): boolean {
		const db = this.db!;
		const row = db.prepare("select generation, current_tool_id from sessions where id = ?").get(sessionId) as
			| { generation: number; current_tool_id: string | null }
			| undefined;
		if (!row || row.generation !== generation || row.current_tool_id === null) return false;
		if (id !== undefined && row.current_tool_id !== id) return false;
		db.prepare(
			`update sessions set current_tool = null, current_tool_id = null, current_tool_arg = null, current_tool_since = null,
			source = 'bridge', updated_at = ? where id = ?`,
		).run(Date.now(), sessionId);
		return true;
	}

	/** Only the session's current generation reports its activity; a superseded process's messages are ignored. */
	private setRunState(sessionId: string, generation: number, run: RunState): void {
		const db = this.db!;
		const row = db.prepare("select run_state, generation from sessions where id = ?").get(sessionId) as
			| { run_state: RunState; generation: number }
			| undefined;
		if (!row || row.generation !== generation || row.run_state === run) return;
		db.prepare("update sessions set run_state = ?, source = 'bridge', updated_at = ? where id = ?").run(
			run,
			Date.now(),
			sessionId,
		);
		this.event("bridge", sessionId, generation, "run_state", { from: row.run_state, to: run });
		if (run === "idle" && row.run_state !== "compacting") {
			// A program consumes its temporary person's reply; only lasting roots need the operator to see a settle.
			const now = Date.now();
			db.prepare(
				"update sessions set settled_at = ?, needs_you_since = case when kind = 'root' and not exists (select 1 from program_peers p where p.session_id = sessions.id) then coalesce(needs_you_since, ?) end where id = ?",
			).run(now, now, sessionId);
		}
	}

	/** The operator saw the session, in its pane or through a command; only an open prompt still needs them. */
	private seen(sessionId: string, via: "pane" | "command"): void {
		this.db!.prepare(
			"update sessions set seen_at = ?, needs_you_since = case when prompt is null then null else needs_you_since end where id = ?",
		).run(Date.now(), sessionId);
		this.event("runtime", sessionId, null, "seen", { via });
	}

	private setProcessState(sessionId: string, generation: number, state: ProcessState, source: string): void {
		const db = this.db!;
		const row = db
			.prepare("select process_state from incarnations where session_id = ? and generation = ?")
			.get(sessionId, generation) as { process_state: ProcessState } | undefined;
		if (!row || row.process_state === state) return;
		db.prepare(
			"update incarnations set process_state = ?, source = ?, updated_at = ? where session_id = ? and generation = ?",
		).run(state, source, Date.now(), sessionId, generation);
		this.event(source, sessionId, generation, "process_state", { from: row.process_state, to: state });
	}

	private endIncarnation(
		sessionId: string,
		generation: number,
		state: ProcessState,
		source: string,
		reason: string,
	): void {
		this.setProcessState(sessionId, generation, state, source);
		const ended = this.db!.prepare(
			"update incarnations set ended_at = ?, end_reason = ? where session_id = ? and generation = ? and ended_at is null",
		).run(Date.now(), reason, sessionId, generation);
		if (ended.changes) this.event(source, sessionId, generation, "incarnation_ended", { reason });
	}

	/**
	 * Bridges first: a live, recently heard connection means alive. Without one, the process decides, for the
	 * current incarnation and for superseded ones whose process may still run.
	 */
	private checkLiveness(): void {
		const db = this.db;
		if (!db) return;
		const now = Date.now();
		const heard = new Set<string>();
		for (const connection of this.connections) {
			if (connection.shutdown || connection.sessionId === undefined) continue;
			if (now - connection.lastSeen <= SILENCE_MS) heard.add(`${connection.sessionId}:${connection.generation}`);
		}
		const tracked = db
			.prepare("select * from incarnations where process_state in ('alive', 'alive_bridge_lost')")
			.all() as unknown as IncarnationRow[];
		for (const row of tracked) {
			const key = `${row.session_id}:${row.generation}`;
			if (heard.has(key)) {
				this.setProcessState(row.session_id, row.generation, "alive", "bridge");
				continue;
			}
			const check = checkProcess(row.pid, row.process_started_at);
			if (check === "gone") {
				this.endIncarnation(row.session_id, row.generation, "lost", "runtime", "process gone");
				this.failedChecks.delete(key);
				continue;
			}
			this.setProcessState(row.session_id, row.generation, "alive_bridge_lost", "runtime");
			if (check === "unknown" && !this.failedChecks.has(key)) {
				this.failedChecks.add(key);
				this.event("runtime", row.session_id, row.generation, "process_check_failed", { pid: row.pid });
			}
		}
	}

	/** Read every live tmux server and bring the topology tables up to date, one transaction per pass. */
	private async pollTmux(): Promise<void> {
		if (this.polling || !this.db) return;
		this.polling = true;
		try {
			const db = this.db;
			const sockets = new Set(await socketFiles());
			const known = db
				.prepare(
					`select socket from tmux_servers union select tmux_socket from incarnations
					where tmux_socket is not null and process_state in ('alive', 'alive_bridge_lost')`,
				)
				.all() as { socket: string }[];
			for (const row of known) sockets.add(row.socket);
			for (const start of this.starting.values()) if (start.socket) sockets.add(start.socket);
			const options = { timeout: TMUX_POLL_MS, signal: this.stopping.signal };
			// Only a start whose window existed before this read began can be missing from it.
			const startsBeforeRead = new Set([...this.starting.values()].filter((start) => start.pane));
			// A client showing a pane saw only what had settled before the clients were read.
			const readStartedAt = Date.now();
			const reads = [...sockets].map(async (socket) => {
				const panes = await listPanes(socket, options);
				return { socket, panes, clients: panes === "absent" ? [] : await listClients(socket, options) };
			});
			const servers = await Promise.allSettled(reads);
			if (this.db !== db) return; // stopped while tmux answered
			db.exec("begin");
			try {
				[...sockets].forEach((socket, index) => {
					const result = servers[index];
					if (result.status === "fulfilled") {
						this.failingServers.delete(socket);
						this.syncServer(socket, result.value.panes, startsBeforeRead);
						this.seeShownPanes(
							socket,
							result.value.clients.map((client) => client.pane),
							readStartedAt,
						);
					} else if (!this.failingServers.has(socket)) {
						// A failed read proves nothing: the server keeps its rows until a read succeeds.
						this.failingServers.add(socket);
						const message = (result.reason as Error).message;
						console.error(`tmux read failed for ${socket}: ${message}`);
						this.event("tmux", null, null, "tmux_server_read_failed", { socket, error: message });
					}
				});
				this.bindPaneTtys();
				db.exec("commit");
			} catch (error) {
				db.exec("rollback");
				throw error;
			}
			for (const result of servers) {
				if (this.db !== db) return;
				if (result.status !== "fulfilled") continue;
				if (result.value.panes === "absent") this.attentionShown.delete(result.value.socket);
				else await this.showAttention(result.value.socket, result.value.clients);
			}
		} catch (error) {
			// A failed pass changes nothing; the next one tries again. The error goes to the runtime log.
			console.error(`tmux poll failed: ${(error as Error).stack ?? error}`);
		} finally {
			this.polling = false;
		}
	}

	/** A session whose pane a client shows has been seen, once it settled after the last time it was. */
	private seeShownPanes(socket: string, shown: string[], readStartedAt: number): void {
		if (shown.length === 0) return;
		const rows = this.db!.prepare(
			`select s.id from sessions s join incarnations i on i.session_id = s.id and i.generation = s.generation
			where i.ended_at is null and i.tmux_socket = ? and i.pane_id in (${shown.map(() => "?").join(", ")})
				and coalesce(s.settled_at, 0) > coalesce(s.seen_at, 0) and s.settled_at < ?`,
		).all(socket, ...shown, readStartedAt) as { id: string }[];
		for (const { id } of rows) this.seen(id, "pane");
	}

	/**
	 * Write a server's status-line summary (`@pi_agents`) and jump target (`@pi_jump_target`) when they change,
	 * from the live top-level sessions in its panes.
	 */
	private async showAttention(socket: string, clients: { name: string; pane: string }[]): Promise<void> {
		const rows = (
			this.db!.prepare(
				`select i.pane_id, s.run_state, s.prompt, s.needs_you_since from sessions s
				join incarnations i on i.session_id = s.id and i.generation = s.generation
				where s.kind = 'root' and i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost')
					and i.tmux_socket = ? and i.pane_id is not null`,
			).all(socket) as { pane_id: string; run_state: string; prompt: string | null; needs_you_since: number | null }[]
		).map(
			(row): AttentionRow => ({
				paneId: row.pane_id,
				runState: row.run_state,
				prompt: row.prompt !== null,
				needsYouSince: row.needs_you_since,
			}),
		);
		const options = { "@pi_agents": statusSummary(rows), "@pi_jump_target": jumpTarget(rows) };
		const written = JSON.stringify(options);
		if (this.attentionShown.get(socket) === written) return;
		try {
			await setServerOptions(
				socket,
				options,
				clients.map((client) => client.name),
				AbortSignal.any([this.stopping.signal, AbortSignal.timeout(TMUX_POLL_MS)]),
			);
			this.attentionShown.set(socket, written);
		} catch (error) {
			console.error(`writing attention to ${socket} failed: ${(error as Error).message}`);
		}
	}

	/** A socket where tmux says no server runs (none ever ran there, or it exited) has no rows. */
	private syncServer(socket: string, read: PaneRow[] | "absent", startsBeforeRead: Set<unknown>): void {
		const db = this.db!;
		const panes = read === "absent" ? undefined : read;
		for (const [sessionId, start] of this.starting) {
			if (start.socket !== socket || !startsBeforeRead.has(start)) continue;
			if (panes?.some((pane) => pane.paneId === start.pane && !pane.dead)) continue;
			this.starting.delete(sessionId);
			this.setCommandStage(start.commandId, "failed", "the window closed before the session started");
		}
		const present = db.prepare("select 1 from tmux_servers where socket = ?").get(socket) !== undefined;
		if (panes && !present) {
			db.prepare("insert into tmux_servers (socket, source, updated_at) values (?, 'tmux', ?)").run(socket, Date.now());
			this.event("tmux", null, null, "tmux_server_added", { socket });
		}
		for (const { table, kind, key, fields } of TOPOLOGY) {
			const rows = new Map<string, Fields>();
			for (const pane of panes ?? []) rows.set(key(pane), fields(pane));
			this.syncTable(table, kind, socket, rows);
		}
		if (!panes && present) {
			db.prepare("delete from tmux_servers where socket = ?").run(socket);
			this.event("tmux", null, null, "tmux_server_removed", { socket });
		}
	}

	private syncTable(table: string, kind: string, socket: string, rows: Map<string, Fields>): void {
		const db = this.db!;
		const now = Date.now();
		const existing = new Map(
			(db.prepare(`select * from ${table} where socket = ?`).all(socket) as Fields[]).map((row) => [
				String(row.id),
				row,
			]),
		);
		for (const [id, row] of rows) {
			const columns = Object.keys(row);
			const old = existing.get(id);
			if (!old) {
				db.prepare(
					`insert into ${table} (socket, id, ${columns.join(", ")}, source, updated_at)
					values (?, ?, ${columns.map(() => "?").join(", ")}, 'tmux', ?)`,
				).run(socket, id, ...Object.values(row), now);
				this.event("tmux", null, null, `${kind}_added`, { socket, id, ...row });
				continue;
			}
			const changed = columns.filter((column) => old[column] !== row[column]);
			if (changed.length === 0) continue;
			db.prepare(
				`update ${table} set ${changed.map((column) => `${column} = ?`).join(", ")}, source = 'tmux', updated_at = ?
				where socket = ? and id = ?`,
			).run(...changed.map((column) => row[column]), now, socket, id);
			this.event("tmux", null, null, `${kind}_changed`, {
				socket,
				id,
				changes: Object.fromEntries(changed.map((column) => [column, { from: old[column], to: row[column] }])),
			});
		}
		for (const id of existing.keys()) {
			if (rows.has(id)) continue;
			db.prepare(`delete from ${table} where socket = ? and id = ?`).run(socket, id);
			this.event("tmux", null, null, `${kind}_removed`, { socket, id });
		}
	}

	/** A bound incarnation learns its pane's tty from tmux once the topology has the pane; tmux is that fact's source. */
	private bindPaneTtys(): void {
		const db = this.db!;
		const unbound = db
			.prepare(
				`select i.session_id, i.generation, p.tty from incarnations i
				join tmux_panes p on p.socket = i.tmux_socket and p.id = i.pane_id
				where i.pane_tty is null and i.ended_at is null`,
			)
			.all() as { session_id: string; generation: number; tty: string }[];
		for (const row of unbound) {
			db.prepare(
				"update incarnations set pane_tty = ?, source = 'tmux', updated_at = ? where session_id = ? and generation = ?",
			).run(row.tty, Date.now(), row.session_id, row.generation);
			this.event("tmux", row.session_id, row.generation, "incarnation_pane_tty", { tty: row.tty });
		}
	}

	private event(
		source: string,
		sessionId: string | null,
		generation: number | null,
		type: string,
		data: unknown,
	): void {
		this.db!.prepare(
			"insert into events (at, source, session_id, generation, type, data) values (?, ?, ?, ?, ?, ?)",
		).run(Date.now(), source, sessionId, generation, type, JSON.stringify(data));
	}
}

/**
 * The wanted entries of a transcript, read line by line in one pass. A transcript can be larger than the longest
 * string V8 allows, so it is never read whole; a line is parsed only when the first id on it is wanted.
 */
async function scanTranscript(file: string, wanted: Set<string>): Promise<Map<string, unknown>> {
	const found = new Map<string, unknown>();
	const lines = createInterface({ input: createReadStream(file, "utf8"), crlfDelay: Infinity });
	for await (const line of lines) {
		const at = line.indexOf('"id":"');
		if (at < 0) continue;
		const id = line.slice(at + 6, line.indexOf('"', at + 6));
		if (!wanted.has(id) || found.has(id)) continue;
		try {
			found.set(id, JSON.parse(line));
		} catch {}
	}
	return found;
}
