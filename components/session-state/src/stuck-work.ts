import { readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { visibleLiveBundles } from "../../shared/src/ledger-files.js";
import { rootOf } from "./tree.js";

export const UNASSIGNED_AFTER_MS = 15 * 60_000;
export const SILENT_AFTER_MS = 4 * 3_600_000;
const WATCHED_LEDGER_STATUS = new Set(["ready", "in-progress"]);

interface TaskRow {
	id: string;
	bundle: string;
	organization: string;
	ephemeral: number;
	thread: string;
	opened_at: number | null;
}

export interface Holder {
	id: string;
	name: string;
	awake: boolean;
	runState: string;
	focused: boolean;
	assignedAt: number;
	assignedBy: string;
}

export interface TaskState {
	key: string;
	id?: string;
	bundle: string;
	title: string;
	status: string | null;
	ephemeral: boolean;
	thread?: string;
	organization: string;
	openedAt: number;
	update: { at: number; what: string };
	holders: Holder[];
}

export interface StuckTask extends TaskState {
	reason: "unassigned" | "silent";
}

function nameOf(db: DatabaseSync, id: string): string {
	return (
		(db.prepare("select name from sessions where id = ?").get(id) as { name: string | null } | undefined)?.name || id
	);
}

function readGoal(bundle: string): { title: string; status: string | null; mtime: number } | undefined {
	try {
		const file = join(bundle, "task.md");
		const text = readFileSync(file, "utf8");
		return {
			title: text.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(bundle),
			status:
				text
					.match(/^Status:\s*(.+)$/m)?.[1]
					?.trim()
					.toLowerCase() ?? null,
			mtime: statSync(file).mtimeMs,
		};
	} catch (error) {
		if (["ENOENT", "EACCES", "ENOTDIR"].includes((error as NodeJS.ErrnoException).code ?? "")) return undefined;
		throw error;
	}
}

function latest(...updates: ({ at: number | null | undefined; what: string } | undefined)[]): {
	at: number;
	what: string;
} {
	let best = { at: 0, what: "nothing recorded" };
	for (const update of updates) if (update?.at && update.at > best.at) best = { at: update.at, what: update.what };
	return best;
}

function holdersOf(db: DatabaseSync, task: string): Holder[] {
	const rows = db
		.prepare(
			`select a.person, a.assigned_at, a.assigned_by, s.run_state,
				exists (select 1 from incarnations i where i.session_id = a.person and i.generation = s.generation
					and i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost')) as awake,
				exists (select 1 from work_focus f where f.person = a.person and f.task_id = a.task_id) as focused
			from assignments a join sessions s on s.id = a.person
			where a.task_id = ? and a.ended_at is null order by a.assigned_at`,
		)
		.all(task) as {
		person: string;
		assigned_at: number;
		assigned_by: string;
		run_state: string;
		awake: number;
		focused: number;
	}[];
	return rows.map((row) => ({
		id: row.person,
		name: nameOf(db, row.person),
		awake: Boolean(row.awake),
		runState: row.run_state,
		focused: Boolean(row.focused),
		assignedAt: row.assigned_at,
		assignedBy: row.assigned_by,
	}));
}

export function taskState(db: DatabaseSync, task: TaskRow): TaskState | undefined {
	const goal = readGoal(task.bundle);
	if (!goal) return undefined;
	const message = db
		.prepare("select at, sender from thread_messages where thread_id = ? order by seq desc limit 1")
		.get(task.thread) as { at: number; sender: string } | undefined;
	const assignment = db
		.prepare("select max(max(assigned_at), coalesce(max(ended_at), 0)) as at from assignments where task_id = ?")
		.get(task.id) as { at: number | null };
	const focus = db
		.prepare("select max(max(started_at), coalesce(max(ended_at), 0)) as at from focus_spans where task_id = ?")
		.get(task.id) as { at: number | null };
	const openedAt = task.opened_at ?? goal.mtime;
	return {
		key: task.id,
		id: task.id,
		bundle: task.bundle,
		title: goal.title,
		status: goal.status,
		ephemeral: Boolean(task.ephemeral),
		thread: task.thread,
		organization: rootOf(db, task.organization),
		openedAt,
		update: latest(
			{ at: openedAt, what: "opened" },
			{ at: goal.mtime, what: "task.md edited" },
			message && { at: message.at, what: `message from ${nameOf(db, message.sender)}` },
			{ at: assignment.at, what: "assignment changed" },
			{ at: focus.at, what: "focus changed" },
		),
		holders: holdersOf(db, task.id),
	};
}

export function openTaskState(db: DatabaseSync, id: string): TaskState | undefined {
	const row = db.prepare("select * from work_tasks where id = ? and archived_at is null").get(id) as
		| TaskRow
		| undefined;
	return row && taskState(db, row);
}

function watched(state: TaskState): boolean {
	return state.ephemeral
		? state.status !== "done" && state.status !== "cancelled"
		: WATCHED_LEDGER_STATUS.has(state.status ?? "");
}

function organizations(db: DatabaseSync): { id: string; cwd: string }[] {
	return db
		.prepare(
			`select id, cwd from sessions where kind = 'root' and reports_to is null and retired_at is null
			and id not in (select session_id from program_peers)`,
		)
		.all() as { id: string; cwd: string }[];
}

export function coordinatorOf(db: DatabaseSync, organization: string): string {
	const candidates = db
		.prepare(
			`select id from sessions where role = 'coordinator' and kind = 'root' and retired_at is null
			and id not in (select session_id from program_peers) order by coalesce(hired_at, updated_at), id`,
		)
		.all() as { id: string }[];
	return candidates.find((row) => rootOf(db, row.id) === organization)?.id ?? organization;
}

function openTasks(db: DatabaseSync, live: Set<string>): TaskState[] {
	const states: TaskState[] = [];
	const registered = new Set<string>();
	for (const row of db.prepare("select * from work_tasks").all() as unknown as (TaskRow & {
		archived_at: number | null;
	})[]) {
		registered.add(row.bundle);
		if (row.archived_at !== null) continue;
		const state = taskState(db, row);
		if (state && live.has(state.organization)) states.push(state);
	}
	for (const organization of organizations(db)) {
		let bundles: string[];
		try {
			bundles = visibleLiveBundles(organization.cwd);
		} catch {
			continue;
		}
		for (const bundle of bundles) {
			if (registered.has(bundle)) continue;
			registered.add(bundle);
			const goal = readGoal(bundle);
			if (!goal) continue;
			states.push({
				key: bundle,
				bundle,
				title: goal.title,
				status: goal.status,
				ephemeral: false,
				organization: organization.id,
				openedAt: goal.mtime,
				update: { at: goal.mtime, what: "task.md edited" },
				holders: [],
			});
		}
	}
	return states;
}

export function stuckWork(
	db: DatabaseSync,
	now: number,
): { organization: string; recipient: string; tasks: StuckTask[] }[] {
	const live = new Set(organizations(db).map((row) => row.id));
	const notice = db.prepare("select at from task_notices where task = ?");
	const snooze = db.prepare("select until, at from task_snoozes where task = ?");
	const grouped = new Map<string, { organization: string; recipient: string; tasks: StuckTask[] }>();
	for (const state of openTasks(db, live)) {
		if (!watched(state)) continue;
		const reason = state.holders.length ? "silent" : "unassigned";
		const after = reason === "silent" ? SILENT_AFTER_MS : UNASSIGNED_AFTER_MS;
		const noticed = (notice.get(state.key) as { at: number } | undefined)?.at ?? 0;
		if (now - Math.max(state.update.at, noticed) < after) continue;
		const quiet = snooze.get(state.key) as { until: number; at: number } | undefined;
		if (quiet && quiet.until > now && state.update.at <= quiet.at) continue;
		const recipient = coordinatorOf(db, state.organization);
		const group = grouped.get(recipient) ?? { organization: state.organization, recipient, tasks: [] };
		group.tasks.push({ ...state, reason });
		grouped.set(recipient, group);
	}
	return [...grouped.values()];
}

export function markNoticed(db: DatabaseSync, tasks: StuckTask[], now: number): void {
	const upsert = db.prepare(
		"insert into task_notices (task, at) values (?, ?) on conflict (task) do update set at = excluded.at",
	);
	for (const task of tasks) upsert.run(task.key, now);
}

export function snoozeTask(db: DatabaseSync, task: string, until: number, by: string, now: number): void {
	if (!(until > now)) throw new Error("A snooze needs a time in the future.");
	db.prepare(
		`insert into task_snoozes (task, until, at, by) values (?, ?, ?, ?)
		on conflict (task) do update set until = excluded.until, at = excluded.at, by = excluded.by`,
	).run(task, until, now, by);
}

function ago(now: number, at: number): string {
	const minutes = Math.max(0, Math.round((now - at) / 60_000));
	if (minutes < 90) return `${minutes}m`;
	const hours = Math.round(minutes / 60);
	return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

function holderLine(now: number, holder: Holder): string {
	const presence = holder.awake
		? holder.runState === "idle"
			? "awake, idle"
			: `awake, ${holder.runState}`
		: "at home";
	return `${holder.name} (${presence}${holder.focused ? ", focused on it" : ", not focused on it"}; assigned ${ago(now, holder.assignedAt)} ago)`;
}

export function describeTask(state: TaskState, now: number): string {
	const lines = [
		`${state.title} [${state.key}]${state.status ? ` · ${state.status}` : ""}`,
		`Goal: ${join(state.bundle, "task.md")}${state.thread ? ` · Thread: ${state.thread}` : ""}`,
		`Last update ${ago(now, state.update.at)} ago (${state.update.what}).`,
		state.holders.length
			? `Held by ${state.holders.map((holder) => holderLine(now, holder)).join("; ")}.`
			: `Nobody holds it (open ${ago(now, state.openedAt)}).`,
	];
	return lines.join("\n");
}

export function stuckDigest(tasks: StuckTask[], now: number): string {
	const items = tasks.map((task, index) => {
		const why = `${task.reason === "unassigned" ? "unassigned" : "held"}, no update for ${ago(now, task.update.at)}`;
		return `${index + 1}. ${why}: ${describeTask(task, now).replace(/\n/g, "\n   ")}`;
	});
	return [
		`${tasks.length === 1 ? "This task is" : "These tasks are"} stuck. For each, assign it, check in with its holder in its task thread, close it, or quiet it with \`snooze\` (any update ends a snooze).`,
		"",
		...items,
	].join("\n");
}
