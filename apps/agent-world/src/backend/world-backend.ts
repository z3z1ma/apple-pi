// The Agent World backend: a plain Node module with no Electron import. Electron's main process wires it to IPC;
// tests call it directly. It reads the session-state database (query-only, never writing) and holds a connection to
// the runtime's socket, whose loss means the runtime is gone. Its only own state, the remembered wings, goes back
// through that socket as a `set_preference` command.
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { DatabaseSync } from "node:sqlite";
import type {
	CommandResult,
	DormantAgent,
	FeedLine,
	KeptPart,
	MailItem,
	MailThreadSummary,
	ProfileRead,
	TerminalResult,
	Workplace,
	WorldSnapshot,
	WorldUpdate,
} from "../world.js";
import { FACTS_JOINS, type FactsRow, factsColumns, factsOf, parseShared, taskReader } from "./facts.js";
import { FEED_SINCE, type FeedLookup, type FeedRow, feedLine } from "./feed.js";
import { dormantAgents } from "./inn.js";
import { readMail, readOperatorMail } from "./mail.js";
import { type Projection, placeWorkplace, projectWorld, type RememberedWings, type SessionRow } from "./projection.js";
import { switchToPane } from "./terminal.js";
import { workplaceReader } from "./workplace.js";

export interface WorldBackend {
	snapshot(): WorldSnapshot;
	profile(characterId: string): ProfileRead;
	/** Calls `listener` with the new snapshot after each change; returns a function that stops the calls. */
	subscribe(listener: (snapshot: WorldSnapshot) => void): () => void;
	/** The latest feed lines, oldest first: a backlog from before the world opened, then everything since. */
	feed(): FeedLine[];
	/** Calls `listener` with each batch of new feed lines, in order; returns a function that stops the calls. */
	subscribeFeed(listener: (lines: FeedLine[]) => void): () => void;
	/** Switch the operator's tmux client to an awake character's pane. */
	goToTerminal(characterId: string): Promise<TerminalResult>;
	/** Choose the avatar's look; the snapshot shows it at once, and it resolves once the runtime stored it. */
	setAvatarLook(look: string): Promise<CommandResult>;
	/** Choose the theme; the snapshot shows it at once, and it resolves once the runtime stored it. */
	setTheme(id: string): Promise<CommandResult>;
	close(): void;
}

/**
 * Turns each published snapshot into the update one receiver (the window) is sent: the inn and the mail are left out
 * while they are the same arrays as in the snapshot before, which `publish` keeps them as while unchanged.
 */
export function leaveOutUnchanged(): (snapshot: WorldSnapshot) => WorldUpdate {
	const sent: Partial<Record<KeptPart, unknown>> = {};
	return (snapshot) => {
		const update: WorldUpdate = { ...snapshot };
		const unchanged: KeptPart[] = [];
		for (const part of ["dormant", "mail"] as const) {
			if (part in sent && sent[part] === snapshot[part]) {
				delete update[part];
				unchanged.push(part);
			} else sent[part] = snapshot[part];
		}
		if (unchanged.length) update.unchanged = unchanged;
		return update;
	};
}

/** How often new `events` rows are looked for; updates must reach the world within a second. */
const POLL_MS = 200;
const RECONNECT_MS = 1000;
/** Polls between rereads of the world while no event arrives, so edited `task.md` files show. */
const TASK_REREAD_POLLS = 10;
/** Polls between reads of every session row; between them only the rows events name (and awake ones) are read. */
const FULL_REREAD_POLLS = 150;
/** Feed lines kept for a newly opened window, and how far back the first read looks for them. */
const FEED_KEPT = 200;
const FEED_BACKLOG = 60;
const FEED_BACKLOG_EVENTS = 5000;
/** After a failed preference write, wait this long before sending it again. */
const RETRY_MS = 5000;
/** How long choosing a look waits for the runtime to store it. */
const STORE_TIMEOUT_MS = 5000;
/**
 * The `preferences` key Agent World keeps its choices under:
 * `{ wings: { [coordinator id]: repository[] }, avatar: look, theme: id }`.
 */
export const PREFERENCE_KEY = "agent-world";

// Every top-level session with what places it: awake while its current incarnation is alive. A column a runtime started
// before its migration has not added yet reads as null; explicit work is selected only when its tables exist.
const sessionsSql = (columns: OptionalColumns) => `
select s.id, s.name, s.cwd, s.reports_to as reportsTo, s.git,
	${OPTIONAL_COLUMNS.map((column) => (columns[column] ? `s.${column}` : `null as ${column}`)).join(", ")},
	(select min(f.started_at) from incarnations f where f.session_id = s.id) as firstStartedAt,
	coalesce(i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost'), 0) as awake,
	i.ended_at as stoppedAt, i.end_reason as stopReason,
	${factsColumns(columns.work)}
from sessions s
${FACTS_JOINS}
where s.kind = 'root'`;

// The rows that may have changed since an event sequence: sessions named by a newer event (a session that starts is
// one), and the ones awake at the last read (given as a JSON array of ids), looked up by id.
const changedSql = (columns: OptionalColumns) => `${sessionsSql(columns)}
	and s.id in (select session_id from events where seq > ? union select value from json_each(?))`;
const OPTIONAL_COLUMNS = ["role_title", "manages", "soul", "self", "retired_at", "retired_reason", "hired_at"] as const;
type OptionalColumns = Record<(typeof OPTIONAL_COLUMNS)[number], boolean> & { work: boolean };
const optionalColumns = (db: DatabaseSync): OptionalColumns => {
	const present = new Set(
		(db.prepare("select name from pragma_table_info('sessions')").all() as { name: string }[]).map((row) => row.name),
	);
	return {
		...Object.fromEntries(OPTIONAL_COLUMNS.map((column) => [column, present.has(column)])),
		work: Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = 'work_focus'").get()),
	} as OptionalColumns;
};
const sqlCache = new Map<string, { sessions: string; changed: string }>();
const sqlFor = (columns: OptionalColumns) => {
	const key = [Number(columns.work), ...OPTIONAL_COLUMNS.map((column) => Number(columns[column]))].join("");
	const cached = sqlCache.get(key);
	if (cached) return cached;
	const sql = { sessions: sessionsSql(columns), changed: changedSql(columns) };
	sqlCache.set(key, sql);
	return sql;
};

interface Row extends FactsRow {
	id: string;
	name: string | null;
	manages: number | null;
	retired_at: number | null;
	retired_reason: string | null;
	hired_at: number | null;
	firstStartedAt: number | null;
	awake: number;
	stoppedAt: number | null;
	stopReason: string | null;
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
	const git = parseShared<{ repository?: unknown }>(row.git);
	return {
		id: row.id,
		name: row.name,
		cwd: row.cwd,
		reportsTo: row.reportsTo,
		repository: typeof git?.repository === "string" ? git.repository : null,
		manages: row.manages === 1,
		title: row.role_title,
		retiredAt: row.retired_at,
		retiredReason: row.retired_reason,
		awake: row.awake === 1,
		hiredAt: row.hired_at,
		firstStartedAt: row.firstStartedAt ?? undefined,
		stoppedAt: row.stoppedAt ?? undefined,
	};
}

/** Each coordinator's wings: those in `first`, then any in `then` not among them, in order. */
function mergeWings(first: RememberedWings, then: RememberedWings): RememberedWings {
	const merged: RememberedWings = {};
	for (const id of new Set([...Object.keys(first), ...Object.keys(then)]))
		merged[id] = [...new Set([...(first[id] ?? []), ...(then[id] ?? [])])];
	return merged;
}

/** The operator's choices kept in the preference beside the wings. */
const CHOICES = ["avatar", "theme"] as const;
type Choice = (typeof CHOICES)[number];

export function openWorldBackend(paths: { db: string; socket: string }): WorldBackend {
	const listeners = new Set<(snapshot: WorldSnapshot) => void>();
	let current: WorldSnapshot = { connected: false, headquarters: [], characters: [] };
	let world: Projection | undefined;
	// The inn's sleepers and the rookery's mail, read with the world.
	let dormant: DormantAgent[] = [];
	let mail: MailItem[] = [];
	let operatorMail: MailThreadSummary[] = [];
	let workplace: Workplace | undefined;
	let db: DatabaseSync | undefined;
	let socket: Socket | undefined;
	let socketOpen = false;
	let lastSeq = -1;
	// Every root session's row as last read, and the event sequence they reflect (-1: read them all again).
	const rowsById = new Map<string, Row>();
	const sessionsById = new Map<string, SessionRow>();
	let rowsSeq = -1;
	let closed = false;
	// Wings seen in this run, kept until the runtime has stored them, so a wing never blinks out meanwhile.
	let seen: RememberedWings = {};
	// The wings last sent and not yet stored or failed, so one change is sent once.
	let sending: { commandId: string; value: string } | undefined;
	// The avatar look and the theme chosen in this run, until the runtime has stored them; and who waits for that.
	const chosen: Partial<Record<Choice, string>> = {};
	const stored: Record<Choice, string | null> = { avatar: null, theme: null };
	const waiters = new Set<{ key: Choice; done: (result: CommandResult) => void }>();
	const settle = (key: Choice | undefined, result: CommandResult) => {
		for (const waiter of waiters)
			if (key === undefined || waiter.key === key) {
				waiter.done(result);
				waiters.delete(waiter);
			}
	};
	let retryAt = 0;
	const readTask = taskReader();
	const readWorkplace = workplaceReader(readTask);
	let polls = 0;
	const feedListeners = new Set<(lines: FeedLine[]) => void>();
	let recent: FeedLine[] = [];
	let feedSeq: number | undefined;

	// The JSON of the published snapshot but its inn and mail, which stay the same arrays while unchanged: comparing
	// them whole on every update cost more than reading them, with thousands asleep.
	let currentJson = JSON.stringify(current);
	const publish = (next: WorldSnapshot) => {
		const json = JSON.stringify({ ...next, dormant: undefined, mail: undefined });
		const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);
		if (json === currentJson && same(next.dormant, current.dormant) && same(next.mail, current.mail)) return;
		currentJson = json;
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
		rowsSeq = -1;
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

	/**
	 * Send the wings, the chosen avatar look, and the chosen theme to the runtime when they differ from what it stored,
	 * keeping the preference's other keys.
	 */
	const remember = (preference: Record<string, unknown>, storedWings: RememberedWings, wings: RememberedWings) => {
		const next = mergeWings(storedWings, wings);
		for (const key of CHOICES) {
			const value = preference[key];
			stored[key] = typeof value === "string" ? value : null;
			if (chosen[key] !== undefined && chosen[key] === stored[key]) {
				delete chosen[key];
				settle(key, { ok: true });
			}
		}
		if (JSON.stringify(next) === JSON.stringify(storedWings) && !Object.keys(chosen).length) {
			sending = undefined;
			return;
		}
		const value = { ...preference, wings: next, ...chosen };
		const json = JSON.stringify(value);
		if (!socket || !socketOpen || json === sending?.value || Date.now() < retryAt) return;
		const commandId = `agent-world-${randomUUID()}`;
		sending = { commandId, value: json };
		const command = { kind: "set_preference", key: PREFERENCE_KEY, value };
		socket.write(`${JSON.stringify({ type: "command", commandId, sessionId: "agent-world", command })}\n`);
	};

	/** `rereadTasks`: check the sleepers' task files for changes too (awake characters' are checked on every read). */
	const read = (rereadTasks: boolean): Projection | undefined => {
		openDb();
		if (!db) return undefined;
		try {
			const { seq } = db.prepare("select coalesce(max(seq), 0) as seq from events").get() as { seq: number };
			if (seq === lastSeq && world) return world;
			lastSeq = seq;
			// With thousands asleep, reading every row on each event was most of a read's time; a sleeper's row changes
			// only with an event naming it. A database whose sequence went back is a new one.
			const full = rowsSeq < 0 || seq < rowsSeq || polls % FULL_REREAD_POLLS === 0;
			const awakeIds = [...sessionsById.values()].filter((session) => session.awake).map((session) => session.id);
			const columns = optionalColumns(db);
			const sql = sqlFor(columns);
			const changed = (full
				? db.prepare(sql.sessions).all()
				: db.prepare(sql.changed).all(rowsSeq, JSON.stringify(awakeIds))) as unknown as Row[];
			if (full) {
				rowsById.clear();
				sessionsById.clear();
			} else {
				const removed = db
					.prepare(`select distinct e.session_id as id from events e where e.seq > ?
					and e.session_id is not null and not exists (select 1 from sessions s where s.id = e.session_id and s.kind = 'root')`)
					.all(rowsSeq) as { id: string }[];
				for (const { id } of removed) {
					rowsById.delete(id);
					sessionsById.delete(id);
				}
			}
			for (const row of changed) {
				rowsById.set(row.id, row);
				sessionsById.set(row.id, sessionRow(row));
			}
			rowsSeq = seq;
			const preference = storedPreference(db);
			const storedWings = (
				preference.wings && typeof preference.wings === "object" ? preference.wings : {}
			) as RememberedWings;
			const projected = projectWorld([...sessionsById.values()], mergeWings(storedWings, seen));
			const byId = rowsById;
			const tasksOf = columns.work
				? db.prepare(
						"select t.id, t.bundle from assignments a join work_tasks t on t.id = a.task_id where a.person = ? and a.end_reason = 'finished' group by t.id order by max(a.ended_at) desc",
					)
				: undefined;
			world = {
				...projected,
				characters: projected.characters.map((character) => ({
					...character,
					facts: factsOf(
						byId.get(character.id)!,
						readTask,
						((tasksOf?.all(character.id) ?? []) as { id: string; bundle: string }[]).map(
							(task) => readTask(JSON.stringify({ bundle: task.bundle, taskId: task.id }))?.title ?? task.id,
						),
					),
				})),
			};
			dormant = dormantAgents(world.dormant, byId, (task) => readTask(task, rereadTasks), dormant, !rereadTasks);
			operatorMail = readOperatorMail(db);
			workplace = readWorkplace(db, [...sessionsById.values()], rereadTasks);
			world = placeWorkplace(world, [...sessionsById.values()], workplace);
			const nextMail = readMail(db);
			if (JSON.stringify(nextMail) !== JSON.stringify(mail)) mail = nextMail;
			seen = mergeWings(seen, world.wings);
			remember(preference, storedWings, world.wings);
			return world;
		} catch {
			dropDb();
			return undefined;
		}
	};

	/** New feed lines since the last read; the first read starts with a short backlog. */
	const readFeed = () => {
		if (!db) return;
		const database = db;
		try {
			const { seq } = database.prepare("select coalesce(max(seq), 0) as seq from events").get() as { seq: number };
			// A new database (its sequence behind ours) starts its feed again from a backlog.
			if (feedSeq === undefined || seq < feedSeq) feedSeq = Math.max(0, seq - FEED_BACKLOG_EVENTS);
			if (seq === feedSeq) return;
			const lookup: FeedLookup = {
				command(commandId) {
					const row = database.prepare("select kind, command from commands where command_id = ?").get(commandId) as
						| { kind: string; command: string }
						| undefined;
					return row ? { kind: row.kind, command: parse<Record<string, unknown>>(row.command) ?? {} } : undefined;
				},
				name(sessionId) {
					const row = database.prepare("select name, cwd from sessions where id = ?").get(sessionId) as
						| { name: string | null; cwd: string }
						| undefined;
					return row ? row.name || row.cwd.split("/").pop() || sessionId : undefined;
				},
			};
			const backlog = recent.length === 0;
			const lines: FeedLine[] = [];
			for (;;) {
				const rows = database.prepare(FEED_SINCE).all(feedSeq) as unknown as FeedRow[];
				for (const row of rows) {
					const line = feedLine(row, lookup);
					if (line) lines.push(line);
				}
				feedSeq = rows.at(-1)?.seq ?? seq;
				if (rows.length < 500) break;
			}
			feedSeq = Math.max(feedSeq, seq);
			const fresh = backlog ? lines.slice(-FEED_BACKLOG) : lines;
			if (!fresh.length) return;
			recent = [...recent, ...fresh].slice(-FEED_KEPT);
			for (const listener of feedListeners) listener(fresh);
		} catch {
			dropDb();
		}
	};

	const poll = () => {
		if (closed) return;
		// A ledger task's title or status can change with no runtime event; read the world again now and then.
		const rereadTasks = ++polls % TASK_REREAD_POLLS === 0;
		if (rereadTasks) lastSeq = -1;
		const next = read(rereadTasks);
		readFeed();
		publish({
			connected: socketOpen && next !== undefined,
			headquarters: next?.headquarters ?? current.headquarters,
			characters: next?.characters ?? current.characters,
			avatarLook: chosen.avatar ?? stored.avatar,
			theme: chosen.theme ?? stored.theme,
			dormant,
			mail,
			operatorMail,
			workplace,
		});
	};

	const onLine = (line: string) => {
		const message = parse<{ type?: string; commandId?: string; stage?: string; reason?: string }>(line);
		if (message?.type !== "receipt" || message.commandId !== sending?.commandId || message.stage !== "failed") return;
		console.error(`agent-world: the runtime did not store the preference: ${message.reason ?? "no reason given"}`);
		sending = undefined;
		settle(undefined, { ok: false, reason: `The runtime did not store it: ${message.reason ?? "no reason given"}.` });
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
			rowsSeq = -1;
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

	/** Keep a choice: the snapshot shows it at once; resolves once the runtime stored it (or why not). */
	const choose = (key: Choice, value: string): Promise<CommandResult> => {
		chosen[key] = value;
		const storing = new Promise<CommandResult>((resolve) => {
			let timer: NodeJS.Timeout | undefined;
			const waiter = {
				key,
				done(result: CommandResult) {
					clearTimeout(timer);
					resolve(result);
				},
			};
			timer = setTimeout(() => {
				waiters.delete(waiter);
				resolve({ ok: false, reason: "The session runtime did not store it yet; it will when it answers." });
			}, STORE_TIMEOUT_MS);
			waiters.add(waiter);
		});
		lastSeq = -1; // read again, which sends it
		poll();
		return storing;
	};

	return {
		snapshot: () => current,
		profile(characterId) {
			const row = rowsById.get(characterId);
			return !closed && db && row
				? { ok: true, self: row.self }
				: { ok: false, reason: "This person's profile is not available." };
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		feed: () => recent,
		async goToTerminal(characterId) {
			const character = current.characters.find((c) => c.id === characterId);
			if (!character) return { ok: false, reason: "No such character is awake." };
			const pane = character.facts?.tmux;
			if (!pane) return { ok: false, reason: `${character.name} is not running in tmux.` };
			return switchToPane(pane.socket, pane.pane, character.name);
		},
		subscribeFeed(listener) {
			feedListeners.add(listener);
			return () => feedListeners.delete(listener);
		},
		setAvatarLook: (look) => choose("avatar", look),
		setTheme: (id) => choose("theme", id),
		close() {
			closed = true;
			settle(undefined, { ok: false, reason: "Agent World closed before the runtime stored it." });
			clearInterval(timer);
			clearTimeout(reconnect);
			clearTimeout(retry);
			socket?.destroy();
			dropDb();
			listeners.clear();
			feedListeners.clear();
		},
	};
}
