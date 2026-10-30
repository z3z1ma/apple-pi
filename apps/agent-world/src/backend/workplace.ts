import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
	CharacterFacts,
	CommandReceipt,
	TaskRead,
	ThreadRead,
	Workplace,
	WorkplaceTask,
	WorkplaceTaskHistory,
	WorkplaceTaskParticipation,
	WorkplaceThread,
	WorldSnapshot,
} from "../world.js";
import { OPERATOR } from "../world.js";
import type { Commands } from "./commands.js";
import type { taskReader } from "./facts.js";
import { operatorPane } from "./inn.js";
import { openMailbox, readStoredThread } from "./mail.js";
import { organizationRoots, type SessionRow } from "./projection.js";

const hasTable = (db: DatabaseSync, name: string) =>
	Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name));

/** Same scope as the native directory: live bundles in this directory's ancestors, never a recursive search. */
function visibleBundles(directory: string): string[] {
	if (!existsSync(directory)) return [];
	const result: string[] = [];
	let current = realpathSync(directory);
	while (true) {
		const ledger = join(current, ".ledger");
		if (lstatSync(ledger, { throwIfNoEntry: false })?.isDirectory())
			for (const entry of readdirSync(ledger, { withFileTypes: true }))
				if (entry.isDirectory() && /^\d{12}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name))
					result.push(join(ledger, entry.name));
		const parent = dirname(current);
		if (parent === current) return result;
		current = parent;
	}
}

function readThreads(db: DatabaseSync, roots: Map<string, string>): WorkplaceThread[] {
	if (!hasTable(db, "threads")) return [];
	const topics = db
		.prepare("pragma table_info(threads)")
		.all()
		.some((column) => column.name === "channel_type");
	const visible = topics
		? `(t.kind = 'channel' and (t.channel_type != 'topic' or exists (select 1 from thread_participants own where own.thread_id = t.id and own.participant = 'operator' and own.following = 1))) or (t.kind = 'meeting' and t.closed_at is null)`
		: "t.kind = 'channel' or (t.kind = 'meeting' and t.closed_at is null)";
	const members = new Map<string, string[]>();
	for (const row of db
		.prepare(`select p.thread_id, p.participant from thread_participants p join threads t on t.id = p.thread_id
			where (${visible}) ${topics ? "and (t.kind != 'channel' or p.following = 1)" : ""} order by p.joined_at, p.participant`)
		.all() as { thread_id: string; participant: string }[]) {
		const list = members.get(row.thread_id) ?? [];
		list.push(row.participant);
		members.set(row.thread_id, list);
	}
	const rows = db
		.prepare(`select t.id, t.kind, t.subject, t.created_by as createdBy, t.closed_at,
		${topics ? "t.channel_type as channelType, t.scope_head as scopeHead," : ""}
		coalesce(max(m.seq), 0) as lastSeq, coalesce(max(m.at), t.created_at) as lastAt
		from threads t left join thread_messages m on m.thread_id = t.id
		where ${visible} group by t.id
		order by lastSeq desc, t.id`)
		.all() as unknown as (Omit<WorkplaceThread, "headquarters" | "participants" | "closed"> & {
		closed_at: number | null;
	})[];
	return rows.map(({ closed_at, ...row }) => ({
		...row,
		headquarters: row.scopeHead ?? roots.get(row.createdBy) ?? row.createdBy,
		closed: closed_at !== null,
		participants: members.get(row.id) ?? [],
	}));
}

function readEscalations(db: DatabaseSync, roots: Map<string, string>): Workplace["escalations"] {
	if (!hasTable(db, "threads")) return [];
	// Explicit escalation threads retain ordinary participant/read-cursor delivery.
	const rows = db
		.prepare(`select distinct t.id, t.created_by from threads t
		join thread_participants p on p.thread_id = t.id and p.participant = ?
		join thread_messages m on m.thread_id = t.id and m.seq > p.read_up_to and m.sender != ?
		where t.kind = 'escalation' and t.closed_at is null`)
		.all(OPERATOR, OPERATOR) as { id: string; created_by: string }[];
	return rows.map((row) => ({
		thread: row.id,
		person: row.created_by,
		headquarters: roots.get(row.created_by) ?? row.created_by,
	}));
}

interface TaskRow {
	id: string;
	bundle: string;
	project: string;
	organization: string;
	ephemeral: number;
	thread: string;
	archived_at: number | null;
	opened_at?: number | null;
	close_status?: string | null;
}

interface AssignmentRow {
	task_id: string;
	person: string;
	assigned_at: number;
	ended_at: number | null;
	end_reason: string | null;
	focused: number;
}

function participation(row: AssignmentRow): WorkplaceTaskParticipation {
	const outcome =
		row.ended_at === null
			? "held"
			: row.end_reason === "finished" || row.end_reason === "unassigned" || row.end_reason === "discarded"
				? row.end_reason
				: "unknown";
	return {
		person: row.person,
		assignedAt: row.assigned_at,
		endedAt: row.ended_at,
		outcome,
		focused: row.ended_at === null && row.focused === 1,
	};
}

function taskHistory(
	row: TaskRow,
	goal: NonNullable<CharacterFacts["task"]>,
	participants: WorkplaceTaskParticipation[],
): WorkplaceTaskHistory {
	const times = [
		row.opened_at,
		row.archived_at,
		...participants.flatMap((item) => [item.assignedAt, item.endedAt]),
	].filter((at): at is number => typeof at === "number");
	return {
		...goal,
		id: row.id,
		project: row.project,
		headquarters: row.organization,
		thread: row.thread,
		status: row.close_status ?? goal.status,
		openedAt: row.opened_at ?? null,
		closedAt: row.archived_at,
		updatedAt: times.length ? times.reduce((latest, at) => Math.max(latest, at)) : null,
		participants,
	};
}

/** Files are rediscovered on the backend's task reread, not on each tool or streaming event. */
export function workplaceReader(readTask: ReturnType<typeof taskReader>) {
	let directoryKey: string | undefined;
	const bundles = new Map<string, string[]>();
	return (db: DatabaseSync, sessions: SessionRow[], rereadFiles: boolean): Workplace => {
		const roots = organizationRoots(sessions);
		const threads = readThreads(db, roots);
		const escalations = readEscalations(db, roots);
		if (!hasTable(db, "work_tasks")) return { threads, escalations, tasks: [], workHistory: [] };
		const stored = db.prepare("select * from work_tasks").all() as unknown as TaskRow[];
		const held = new Map<string, WorkplaceTask["assignees"]>();
		const participants = new Map<string, WorkplaceTaskParticipation[]>();
		for (const row of db
			.prepare(`select a.task_id, a.person, a.assigned_at, a.ended_at, a.end_reason, coalesce(f.task_id = a.task_id, 0) as focused
			from assignments a left join work_focus f on f.person = a.person order by a.id`)
			.all() as unknown as AssignmentRow[]) {
			const history = participants.get(row.task_id) ?? [];
			history.push(participation(row));
			participants.set(row.task_id, history);
			if (row.ended_at !== null) continue;
			const list = held.get(row.task_id) ?? [];
			list.push({ person: row.person, focused: row.focused === 1 });
			held.set(row.task_id, list);
		}
		const tasks: WorkplaceTask[] = [];
		const workHistory: WorkplaceTaskHistory[] = [];
		for (const row of stored) {
			const goal = readTask(JSON.stringify({ bundle: row.bundle, taskId: row.id }), rereadFiles)!;
			workHistory.push(taskHistory(row, goal, participants.get(row.id) ?? []));
			if (row.archived_at !== null) continue;
			if (!held.has(row.id) && (goal.status === "done" || goal.status === "cancelled")) continue;
			tasks.push({
				...goal,
				id: row.id,
				project: row.project,
				headquarters: row.organization,
				ephemeral: Boolean(row.ephemeral),
				thread: row.thread,
				assignees: held.get(row.id) ?? [],
			});
		}
		const active = new Set(sessions.filter((person) => person.awake).map((person) => roots.get(person.id)!));
		for (const task of tasks) active.add(task.headquarters);
		const directories = new Map<string, Set<string>>();
		const add = (organization: string, directory: string) => {
			if (!active.has(organization)) return;
			const list = directories.get(organization) ?? new Set<string>();
			list.add(directory);
			directories.set(organization, list);
		};
		for (const person of sessions) if (person.retiredAt === null) add(roots.get(person.id)!, person.cwd);
		for (const row of stored) add(row.organization, row.project);
		const key = JSON.stringify([...directories].map(([org, dirs]) => [org, [...dirs].sort()]));
		if (rereadFiles || key !== directoryKey) {
			bundles.clear();
			for (const [org, dirs] of directories) bundles.set(org, [...new Set([...dirs].flatMap(visibleBundles))].sort());
			directoryKey = key;
		}
		const registered = new Set(stored.map((row) => row.bundle));
		for (const [headquarters, paths] of bundles)
			for (const bundle of paths) {
				if (registered.has(bundle)) continue;
				const goal = readTask(JSON.stringify({ bundle, taskId: basename(bundle) }), rereadFiles)!;
				if (goal.goalMissing || goal.status === "done" || goal.status === "cancelled") continue;
				tasks.push({
					...goal,
					id: bundle,
					project: dirname(dirname(bundle)),
					headquarters,
					ephemeral: false,
					thread: null,
					assignees: [],
				});
			}
		return {
			threads: threads.filter((thread) => thread.kind === "meeting" || active.has(thread.headquarters)),
			escalations,
			tasks,
			workHistory,
		};
	};
}

export interface WorkplaceActions {
	readTask(task: string): Promise<TaskRead>;
	assignTask(person: string, task: string): Promise<CommandReceipt>;
	readWorkplaceThread(thread: string): Promise<ThreadRead>;
	setChannelMembership(thread: string, joined: boolean): Promise<CommandReceipt>;
}

/** The operator observes shared workplace conversations; only a participant marks them read or replies. */
export function openWorkplace(path: string, commands: Commands, snapshot: () => WorldSnapshot): WorkplaceActions {
	const mailbox = openMailbox(path, commands);
	const findTask = (id: string) => snapshot().workplace?.tasks.find((task) => task.id === id || task.bundle === id);
	return {
		async readTask(id) {
			const task =
				findTask(id) ?? snapshot().workplace?.workHistory?.find((task) => task.id === id || task.bundle === id);
			if (!task) return { ok: false, reason: "That task is not in the recorded workplace." };
			try {
				return { ok: true, text: readFileSync(join(task.bundle, "task.md"), "utf8") };
			} catch (error) {
				return { ok: false, reason: `The goal could not be read: ${String(error)}` };
			}
		},
		async assignTask(person, id) {
			const task = findTask(id);
			if (!task) return { ok: false, reason: "That task is no longer on the board." };
			const tmux = await operatorPane(path);
			const result = await commands.send(OPERATOR, {
				kind: "work",
				...(tmux ? { tmux } : {}),
				action: "assign",
				person,
				task: task.id,
				cwd: task.project,
			});
			return result.ok ? { ok: true, stage: "applied" } : result;
		},
		async setChannelMembership(thread, joined) {
			const result = await commands.send(OPERATOR, { kind: "channel_membership", thread, joined });
			return result.ok ? { ok: true, stage: "applied" } : result;
		},
		async readWorkplaceThread(id) {
			if (!existsSync(path)) return { ok: false, reason: "The session database is not available." };
			const db = new DatabaseSync(path);
			let thread: ReturnType<typeof readStoredThread>;
			try {
				db.exec("pragma query_only = 1");
				if (
					hasTable(db, "threads") &&
					db.prepare("select 1 from threads where id = ? and kind in ('channel', 'meeting', 'task')").get(id)
				)
					thread = readStoredThread(db, id);
			} finally {
				db.close();
			}
			if (!thread) return { ok: false, reason: "That shared workplace conversation does not exist." };
			return thread.participants.some((person) => person.id === OPERATOR)
				? mailbox.readThread(id)
				: { ok: true, thread };
		},
	};
}
