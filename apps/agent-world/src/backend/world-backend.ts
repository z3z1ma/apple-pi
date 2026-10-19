// The Agent World backend: a plain Node module with no Electron import. Electron's main process wires it to IPC;
// tests call it directly. It reads the session-state database (query-only, never writing) and holds a connection to
// the runtime's socket, whose loss means the runtime is gone.
import { existsSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Character, WorldSnapshot } from "../world.js";

export interface WorldBackend {
	snapshot(): WorldSnapshot;
	/** Calls `listener` with the new snapshot after each change; returns a function that stops the calls. */
	subscribe(listener: (snapshot: WorldSnapshot) => void): () => void;
	close(): void;
}

/** How often new `events` rows are looked for; updates must reach the world within a second. */
const POLL_MS = 200;
const RECONNECT_MS = 1000;

// An awake character: a root session whose current incarnation is alive.
const AWAKE = `
select s.id, s.name, s.cwd
from sessions s
join incarnations i on i.session_id = s.id and i.generation = s.generation
where s.kind = 'root' and i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost')
order by i.started_at, s.id`;

export function openWorldBackend(paths: { db: string; socket: string }): WorldBackend {
	const listeners = new Set<(snapshot: WorldSnapshot) => void>();
	let current: WorldSnapshot = { connected: false, characters: [] };
	let db: DatabaseSync | undefined;
	let socket: Socket | undefined;
	let socketOpen = false;
	let lastSeq = -1;
	let closed = false;

	const publish = (next: WorldSnapshot) => {
		if (JSON.stringify(next) === JSON.stringify(current)) return;
		current = next;
		for (const listener of listeners) listener(current);
	};

	const openDb = () => {
		if (db || !existsSync(paths.db)) return;
		// Opened for writing but query-only, as the sidebar does: a strictly read-only connection reads no rows from a
		// WAL database whose -shm file is gone, as after the runtime stops.
		db = new DatabaseSync(paths.db);
		db.exec("pragma query_only = 1");
		lastSeq = -1;
	};

	const dropDb = () => {
		db?.close();
		db = undefined;
	};

	const read = (): Character[] | undefined => {
		openDb();
		if (!db) return undefined;
		try {
			const { seq } = db.prepare("select coalesce(max(seq), 0) as seq from events").get() as { seq: number };
			if (seq === lastSeq) return current.characters;
			lastSeq = seq;
			const rows = db.prepare(AWAKE).all() as { id: string; name: string | null; cwd: string }[];
			return rows.map((row) => ({ id: row.id, name: row.name || basename(row.cwd) }));
		} catch {
			dropDb();
			return undefined;
		}
	};

	const poll = () => {
		if (closed) return;
		const characters = read();
		publish({ connected: socketOpen && characters !== undefined, characters: characters ?? current.characters });
	};

	let reconnect: NodeJS.Timeout | undefined;
	const connect = () => {
		if (closed) return;
		const next = createConnection(paths.socket);
		socket = next;
		next.on("connect", () => {
			socketOpen = true;
			lastSeq = -1; // anything may have changed while the runtime was gone
			poll();
		});
		next.on("error", () => {});
		next.on("close", () => {
			socketOpen = false;
			poll();
			if (!closed) reconnect = setTimeout(connect, RECONNECT_MS).unref();
		});
	};

	connect();
	const timer = setInterval(poll, POLL_MS).unref();
	poll();

	return {
		snapshot: () => current,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		close() {
			closed = true;
			clearInterval(timer);
			clearTimeout(reconnect);
			socket?.destroy();
			dropDb();
			listeners.clear();
		},
	};
}
