// The Agent World backend: a plain Node module with no Electron import. Electron's main process wires it to IPC;
// tests call it directly. It reads the session-state database (query-only, never writing) and holds a connection to
// the runtime's socket, whose loss means the runtime is gone. Its only own state, the remembered wings, goes back
// through that socket as a `set_preference` command.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { DatabaseSync } from "node:sqlite";
import type { WorldSnapshot } from "../world.js";
import { type Projection, projectWorld, type RememberedWings, type SessionRow } from "./projection.js";

export interface WorldBackend {
	snapshot(): WorldSnapshot;
	/** Calls `listener` with the new snapshot after each change; returns a function that stops the calls. */
	subscribe(listener: (snapshot: WorldSnapshot) => void): () => void;
	close(): void;
}

/** How often new `events` rows are looked for; updates must reach the world within a second. */
const POLL_MS = 200;
const RECONNECT_MS = 1000;
/** After a failed preference write, wait this long before sending it again. */
const RETRY_MS = 5000;
/** The `preferences` key Agent World keeps its choices under: `{ wings: { [coordinator id]: repository[] } }`. */
export const PREFERENCE_KEY = "agent-world";

// Every top-level session with what places it: awake while its current incarnation is alive.
const SESSIONS = `
select s.id, s.name, s.cwd, s.reports_to as reportsTo, s.git, s.config,
	(select min(f.started_at) from incarnations f where f.session_id = s.id) as firstStartedAt,
	coalesce(i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost'), 0) as awake
from sessions s
left join incarnations i on i.session_id = s.id and i.generation = s.generation
where s.kind = 'root'`;

interface Row {
	id: string;
	name: string | null;
	cwd: string;
	reportsTo: string | null;
	git: string | null;
	config: string | null;
	firstStartedAt: number | null;
	awake: number;
}

function parse<T>(json: string | null | undefined): T | undefined {
	if (!json) return undefined;
	try {
		return JSON.parse(json) as T;
	} catch {
		return undefined;
	}
}

function sessionRow(row: Row): SessionRow {
	const git = parse<{ repository?: unknown }>(row.git);
	const config = parse<{ flags?: unknown }>(row.config);
	return {
		id: row.id,
		name: row.name,
		cwd: row.cwd,
		reportsTo: row.reportsTo,
		repository: typeof git?.repository === "string" ? git.repository : null,
		coordinatorFlag: Array.isArray(config?.flags) && config.flags.includes("coordinator"),
		awake: row.awake === 1,
		firstStartedAt: row.firstStartedAt ?? undefined,
	};
}

/** Each coordinator's wings: those in `first`, then any in `then` not among them, in order. */
function mergeWings(first: RememberedWings, then: RememberedWings): RememberedWings {
	const merged: RememberedWings = {};
	for (const id of new Set([...Object.keys(first), ...Object.keys(then)]))
		merged[id] = [...new Set([...(first[id] ?? []), ...(then[id] ?? [])])];
	return merged;
}

export function openWorldBackend(paths: { db: string; socket: string }): WorldBackend {
	const listeners = new Set<(snapshot: WorldSnapshot) => void>();
	let current: WorldSnapshot = { connected: false, headquarters: [], characters: [] };
	let world: Projection | undefined;
	let db: DatabaseSync | undefined;
	let socket: Socket | undefined;
	let socketOpen = false;
	let lastSeq = -1;
	let closed = false;
	// Wings seen in this run, kept until the runtime has stored them, so a wing never blinks out meanwhile.
	let seen: RememberedWings = {};
	// The wings last sent and not yet stored or failed, so one change is sent once.
	let sending: { commandId: string; wings: string } | undefined;
	let retryAt = 0;

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

	const storedPreference = (database: DatabaseSync): Record<string, unknown> => {
		const row = database.prepare("select value from preferences where key = ?").get(PREFERENCE_KEY) as
			| { value: string }
			| undefined;
		const value = parse<unknown>(row?.value);
		return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	};

	/** Send the wings to the runtime when they differ from what it stored, keeping the preference's other keys. */
	const remember = (stored: Record<string, unknown>, storedWings: RememberedWings, wings: RememberedWings) => {
		const next = mergeWings(storedWings, wings);
		const json = JSON.stringify(next);
		if (json === JSON.stringify(storedWings)) {
			sending = undefined;
			return;
		}
		if (!socket || !socketOpen || json === sending?.wings || Date.now() < retryAt) return;
		const commandId = `agent-world-${randomUUID()}`;
		sending = { commandId, wings: json };
		const command = { kind: "set_preference", key: PREFERENCE_KEY, value: { ...stored, wings: next } };
		socket.write(`${JSON.stringify({ type: "command", commandId, sessionId: "agent-world", command })}\n`);
	};

	const read = (): Projection | undefined => {
		openDb();
		if (!db) return undefined;
		try {
			const { seq } = db.prepare("select coalesce(max(seq), 0) as seq from events").get() as { seq: number };
			if (seq === lastSeq && world) return world;
			lastSeq = seq;
			const sessions = (db.prepare(SESSIONS).all() as unknown as Row[]).map(sessionRow);
			const stored = storedPreference(db);
			const storedWings = (stored.wings && typeof stored.wings === "object" ? stored.wings : {}) as RememberedWings;
			world = projectWorld(sessions, mergeWings(storedWings, seen));
			seen = mergeWings(seen, world.wings);
			remember(stored, storedWings, world.wings);
			return world;
		} catch {
			dropDb();
			return undefined;
		}
	};

	const poll = () => {
		if (closed) return;
		const next = read();
		publish({
			connected: socketOpen && next !== undefined,
			headquarters: next?.headquarters ?? current.headquarters,
			characters: next?.characters ?? current.characters,
		});
	};

	const onLine = (line: string) => {
		const message = parse<{ type?: string; commandId?: string; stage?: string; reason?: string }>(line);
		if (message?.type !== "receipt" || message.commandId !== sending?.commandId || message.stage !== "failed") return;
		console.error(`agent-world: the runtime did not store the wings: ${message.reason ?? "no reason given"}`);
		sending = undefined;
		retryAt = Date.now() + RETRY_MS;
		retry = setTimeout(() => {
			lastSeq = -1; // read again, which sends again
		}, RETRY_MS).unref();
	};

	let reconnect: NodeJS.Timeout | undefined;
	let retry: NodeJS.Timeout | undefined;
	const connect = () => {
		if (closed) return;
		const next = createConnection(paths.socket);
		socket = next;
		let buffer = "";
		next.on("data", (chunk) => {
			buffer += chunk.toString();
			for (let end = buffer.indexOf("\n"); end >= 0; end = buffer.indexOf("\n")) {
				const line = buffer.slice(0, end);
				buffer = buffer.slice(end + 1);
				if (line.trim()) onLine(line);
			}
		});
		next.on("connect", () => {
			socketOpen = true;
			sending = undefined; // a command sent to an earlier runtime may never have been stored
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
			clearTimeout(retry);
			socket?.destroy();
			dropDb();
			listeners.clear();
		},
	};
}
