import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createConnection, type Socket } from "node:net";
import { DatabaseSync } from "node:sqlite";
import type {
	CommandResult,
	Desk,
	DormantAgent,
	FeedLine,
	KeptPart,
	MailItem,
	MailThreadSummary,
	Origin,
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
	subscribe(listener: (snapshot: WorldSnapshot) => void): () => void;
	feed(): FeedLine[];
	subscribeFeed(listener: (lines: FeedLine[]) => void): () => void;
	goToTerminal(characterId: string): Promise<TerminalResult>;
	setAvatarLook(look: string): Promise<CommandResult>;
	setTheme(id: string): Promise<CommandResult>;
	setDesk(desk: Desk): Promise<CommandResult>;
	close(): void;
}

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

const POLL_MS = 200;
const RECONNECT_MS = 1000;
const TASK_REREAD_POLLS = 10;
const FULL_REREAD_POLLS = 150;
const FEED_KEPT = 200;
const FEED_BACKLOG = 60;
const FEED_BACKLOG_EVENTS = 5000;
const RETRY_MS = 5000;
const STORE_TIMEOUT_MS = 5000;
export const PREFERENCE_KEY = "agent-world";
export const DESK_KEY = "desk";

function readDesk(database: DatabaseSync): Desk | null {
	const row = database.prepare("select value from preferences where key = ?").get(DESK_KEY) as
		| { value: string }
		| undefined;
	const value = parse<Partial<Desk>>(row?.value);
	return typeof value?.thread === "string" && typeof value.person === "string"
		? { thread: value.thread, person: value.person }
		: null;
}

const sessionsSql = (columns: OptionalColumns) => `
select s.id, s.name, s.cwd, s.reports_to as reportsTo, s.git,
	${OPTIONAL_COLUMNS.map((column) => (columns[column] ? `s.${column}` : `null as ${column}`)).join(", ")},
	(select min(f.started_at) from incarnations f where f.session_id = s.id) as firstStartedAt,
	coalesce(i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost'), 0) as awake,
	i.ended_at as stoppedAt, i.end_reason as stopReason,
	s.id in (select session_id from events where type in ('program_peer_created', 'program_peer_observed', 'person_discarded')
		${columns.peers ? "union select session_id from program_peers" : ""}) as temporary,
	${factsColumns(columns.work)}
from sessions s
${FACTS_JOINS}
where s.kind = 'root'`;

const changedSql = (columns: OptionalColumns) => `${sessionsSql(columns)}
	and s.id in (select session_id from events where seq > ? union select value from json_each(?))`;
const OPTIONAL_COLUMNS = [
	"role_title",
	"manages",
	"soul",
	"self",
	"retired_at",
	"retired_reason",
	"hired_at",
	"specialization",
	"origin",
] as const;
type OptionalColumns = Record<(typeof OPTIONAL_COLUMNS)[number], boolean> & { work: boolean; peers: boolean };
const optionalColumns = (db: DatabaseSync): OptionalColumns => {
	const present = new Set(
		(db.prepare("select name from pragma_table_info('sessions')").all() as { name: string }[]).map((row) => row.name),
	);
	return {
		...Object.fromEntries(OPTIONAL_COLUMNS.map((column) => [column, present.has(column)])),
		work: Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = 'work_focus'").get()),
		peers: Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = 'program_peers'").get()),
	} as OptionalColumns;
};
const sqlCache = new Map<string, { sessions: string; changed: string }>();
const sqlFor = (columns: OptionalColumns) => {
	const key = [
		Number(columns.work),
		Number(columns.peers),
		...OPTIONAL_COLUMNS.map((column) => Number(columns[column])),
	].join("");
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
	specialization: string | null;
	origin: string | null;
	firstStartedAt: number | null;
	awake: number;
	temporary: number;
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

function originOf(json: string | null): Origin | null {
	const value = parseShared<Partial<Origin>>(json);
	return typeof value?.people === "string" && typeof value.place === "string" && typeof value.pronouns === "string"
		? { people: value.people, place: value.place, pronouns: value.pronouns }
		: null;
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
		specialization: row.specialization,
		origin: originOf(row.origin),
		firstStartedAt: row.firstStartedAt ?? undefined,
		stoppedAt: row.stoppedAt ?? undefined,
	};
}

function mergeWings(first: RememberedWings, then: RememberedWings): RememberedWings {
	const merged: RememberedWings = {};
	for (const id of new Set([...Object.keys(first), ...Object.keys(then)]))
		merged[id] = [...new Set([...(first[id] ?? []), ...(then[id] ?? [])])];
	return merged;
}

const CHOICES = ["avatar", "theme"] as const;
type Choice = (typeof CHOICES)[number];

export function openWorldBackend(paths: { db: string; socket: string }): WorldBackend {
	const listeners = new Set<(snapshot: WorldSnapshot) => void>();
	let current: WorldSnapshot = { connected: false, headquarters: [], characters: [] };
	let world: Projection | undefined;
	let dormant: DormantAgent[] = [];
	let mail: MailItem[] = [];
	let operatorMail: MailThreadSummary[] = [];
	let workplace: Workplace | undefined;
	let desk: Desk | null = null;
	let db: DatabaseSync | undefined;
	let socket: Socket | undefined;
	let socketOpen = false;
	let lastSeq = -1;
	const rowsById = new Map<string, Row>();
	const sessionsById = new Map<string, SessionRow>();
	let rowsSeq = -1;
	let closed = false;
	let seen: RememberedWings = {};
	let sending: { commandId: string; value: string } | undefined;
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
		const commandId = `agent-workplace-${randomUUID()}`;
		sending = { commandId, value: json };
		const command = { kind: "set_preference", key: PREFERENCE_KEY, value };
		socket.write(`${JSON.stringify({ type: "command", commandId, sessionId: "agent-workplace", command })}\n`);
	};

	const read = (rereadTasks: boolean): Projection | undefined => {
		openDb();
		if (!db) return undefined;
		try {
			const { seq } = db.prepare("select coalesce(max(seq), 0) as seq from events").get() as { seq: number };
			if (seq === lastSeq && world) return world;
			lastSeq = seq;
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
					facts: {
						...factsOf(
							byId.get(character.id)!,
							readTask,
							((tasksOf?.all(character.id) ?? []) as { id: string; bundle: string }[]).map(
								(task) => readTask(JSON.stringify({ bundle: task.bundle, taskId: task.id }))?.title ?? task.id,
							),
						),
						temporary: byId.get(character.id)!.temporary === 1,
					},
				})),
			};
			dormant = dormantAgents(world.dormant, byId, (task) => readTask(task, rereadTasks), dormant, !rereadTasks);
			operatorMail = readOperatorMail(db);
			workplace = readWorkplace(db, [...sessionsById.values()], rereadTasks);
			desk = readDesk(db);
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

	const readFeed = () => {
		if (!db) return;
		const database = db;
		try {
			const { seq } = database.prepare("select coalesce(max(seq), 0) as seq from events").get() as { seq: number };
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
			desk,
		});
	};

	const onLine = (line: string) => {
		const message = parse<{ type?: string; commandId?: string; stage?: string; reason?: string }>(line);
		if (message?.type !== "receipt" || message.commandId !== sending?.commandId || message.stage !== "failed") return;
		console.error(`agent-workplace: the runtime did not store the preference: ${message.reason ?? "no reason given"}`);
		sending = undefined;
		settle(undefined, { ok: false, reason: `The runtime did not store it: ${message.reason ?? "no reason given"}.` });
		retryAt = Date.now() + RETRY_MS;
		retry = setTimeout(() => {
			lastSeq = -1;
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
			sending = undefined;
			lastSeq = -1;
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
		lastSeq = -1;
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
		async setDesk(next) {
			if (!socket || !socketOpen) return { ok: false, reason: "The session runtime is not connected." };
			const send = (sessionId: string, command: unknown) =>
				socket?.write(
					`${JSON.stringify({ type: "command", commandId: `agent-workplace-${randomUUID()}`, sessionId, command })}\n`,
				);
			send("agent-workplace", { kind: "set_preference", key: DESK_KEY, value: next });
			send("operator", {
				kind: "channel_charter",
				thread: next.thread,
				listener: next.person,
				charter:
					"This is the operator's desk. Route what he writes here to the right people, reply in under 100 words, and keep him on top of the work.",
			});
			desk = next;
			lastSeq = -1;
			poll();
			return { ok: true };
		},
		close() {
			closed = true;
			settle(undefined, { ok: false, reason: "Agent Workplace closed before the runtime stored it." });
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
