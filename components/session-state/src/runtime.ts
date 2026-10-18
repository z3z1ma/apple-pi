import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { DatabaseSync } from "node:sqlite";
import type { StatePaths } from "./paths.js";
import {
	type BridgeMessage,
	type Hello,
	lineReader,
	type ProcessState,
	type RunState,
	SILENCE_MS,
} from "./protocol.js";
import { migrate } from "./schema.js";

interface Connection {
	socket: Socket;
	sessionId?: string;
	generation?: number;
	lastSeen: number;
	shutdown: boolean;
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
	let started: string;
	try {
		started = execFileSync("ps", ["-o", "lstart=", "-p", String(pid)], { encoding: "utf8" }).trim();
	} catch (error) {
		// `ps` exits 1 with no output when the pid is gone; anything else is a failed check.
		const result = error as { status?: number; stdout?: string };
		return result.status === 1 && !result.stdout?.trim() ? "gone" : "unknown";
	}
	if (started === "") return "gone";
	const time = Date.parse(started);
	if (Number.isNaN(time)) return "unknown";
	return sameStart(time, startedAt) ? "running" : "gone";
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
		rmSync(this.paths.socket, { force: true }); // we hold the lock, so any socket file is stale
		const server = createServer((socket) => this.accept(socket));
		this.server = server;
		await new Promise<void>((resolve, reject) => {
			server.once("error", reject);
			server.listen(this.paths.socket, () => resolve());
		});
		chmodSync(this.paths.socket, 0o600);
		this.timer = setInterval(() => this.checkLiveness(), 1000);
		this.checkLiveness();
		return true;
	}

	stop(): void {
		clearInterval(this.timer);
		for (const connection of this.connections) connection.socket.destroy();
		this.server?.close();
		rmSync(this.paths.socket, { force: true });
		rmSync(this.paths.pid, { force: true });
		this.db?.close();
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
				this.handle(connection, message);
			}),
		);
		socket.on("error", () => {});
		socket.on("close", () => {
			this.connections.delete(connection);
			this.checkLiveness();
		});
	}

	private handle(connection: Connection, message: BridgeMessage): void {
		if (message.type === "hello") {
			this.hello(connection, message);
			return;
		}
		const { sessionId, generation } = connection;
		if (sessionId === undefined || generation === undefined) return;
		if (message.type === "run") this.setRunState(sessionId, generation, message.run);
		else if (message.type === "shutdown") {
			connection.shutdown = true;
			this.endIncarnation(sessionId, generation, "exited", "bridge", message.reason);
			this.setRunState(sessionId, generation, "idle");
		}
	}

	private hello(connection: Connection, hello: Hello): void {
		const db = this.db!;
		const now = Date.now();
		const { session, process: proc } = hello;
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
			db.prepare(
				`insert into incarnations (session_id, generation, pid, process_started_at, process_state, started_at, source, updated_at)
				values (?, ?, ?, ?, 'alive', ?, 'bridge', ?)`,
			).run(session.id, generation, proc.pid, proc.startedAt, now, now);
			this.event("bridge", session.id, generation, "incarnation_started", { pid: proc.pid });
		}
		db.prepare(
			`insert into sessions (id, kind, session_file, cwd, name, run_state, generation, source, updated_at)
			values (?, ?, ?, ?, ?, 'idle', ?, 'bridge', ?)
			on conflict (id) do update set kind = excluded.kind, session_file = excluded.session_file, cwd = excluded.cwd,
				name = excluded.name, generation = excluded.generation, source = 'bridge', updated_at = excluded.updated_at`,
		).run(session.id, session.kind, session.file ?? null, session.cwd, session.name ?? null, generation, now);
		connection.sessionId = session.id;
		connection.generation = generation;
		this.setRunState(session.id, generation, hello.run);
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
