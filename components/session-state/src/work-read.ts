import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { visibleLiveBundles } from "../../shared/src/ledger-files.js";
import type { Assignment, WorkTask } from "./work.js";

export interface TaskSummary {
	id: string;
	bundle: string;
	title: string;
	status: string | null;
	ephemeral: boolean;
	thread: string | null;
	goalMissing?: boolean;
}

export interface AssignedTask extends TaskSummary {
	assignment: number;
	assignedBy: string;
	assignedAt: number;
	endedAt: number | null;
	endReason: string | null;
	outcome: string | null;
}

export function hasWork(db: DatabaseSync): boolean {
	return Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = 'work_tasks'").get());
}

function summary(task: Pick<WorkTask, "id" | "bundle" | "ephemeral"> & { thread: string | null }): TaskSummary {
	const base = { id: task.id, bundle: task.bundle, ephemeral: Boolean(task.ephemeral), thread: task.thread };
	let text: string;
	try {
		text = readFileSync(join(task.bundle, "task.md"), "utf8");
	} catch (error) {
		if (!["ENOENT", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
		return { ...base, title: basename(task.bundle), status: null, goalMissing: true };
	}
	return {
		...base,
		title: text.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(task.bundle),
		status: text.match(/^Status:\s*(.+)$/m)?.[1]?.trim() ?? null,
	};
}

export function workOf(
	db: DatabaseSync,
	person: string,
): { tasks: AssignedTask[]; focus: AssignedTask | null; record: AssignedTask[] } {
	if (!hasWork(db)) return { tasks: [], focus: null, record: [] };
	const focus = db.prepare("select task_id from work_focus where person = ?").get(person) as
		| { task_id: string }
		| undefined;
	const rows = db
		.prepare(
			`select a.*, t.bundle, t.ephemeral, t.thread from assignments a join work_tasks t on t.id = a.task_id where a.person = ? order by coalesce(a.ended_at, a.assigned_at) desc, a.id desc`,
		)
		.all(person) as unknown as (Assignment & Pick<WorkTask, "bundle" | "ephemeral" | "thread">)[];
	const all = rows.map(
		(row): AssignedTask => ({
			...summary({ id: row.task_id, bundle: row.bundle, ephemeral: row.ephemeral, thread: row.thread }),
			assignment: row.id,
			assignedBy: row.assigned_by,
			assignedAt: row.assigned_at,
			endedAt: row.ended_at,
			endReason: row.end_reason,
			outcome: row.outcome,
		}),
	);
	const tasks = all.filter((task) => task.endedAt === null);
	return {
		tasks,
		focus: tasks.find((task) => task.id === focus?.task_id) ?? null,
		record: all.filter((task) => task.endReason === "finished"),
	};
}

/** Only ledgers visible from this organization's directories; discovering a task never assigns it. */
export function backlogOf(db: DatabaseSync, organization: string, directories: string[]): TaskSummary[] {
	if (!hasWork(db)) return [];
	const projects = db.prepare("select distinct project from work_tasks where organization = ?").all(organization) as {
		project: string;
	}[];
	const bundles = new Set<string>();
	for (const directory of new Set([...directories, ...projects.map((row) => row.project)])) {
		if (existsSync(directory)) for (const bundle of visibleLiveBundles(directory)) bundles.add(bundle);
	}
	const backlog: TaskSummary[] = [];
	for (const bundle of [...bundles].sort()) {
		const stored = db.prepare("select * from work_tasks where bundle = ?").get(bundle) as unknown as
			| WorkTask
			| undefined;
		if (
			stored &&
			(stored.organization !== organization ||
				db.prepare("select 1 from assignments where task_id = ? and ended_at is null").get(stored.id))
		)
			continue;
		const task = summary(stored ?? { id: bundle, bundle, ephemeral: 0, thread: null });
		if (!task.goalMissing && task.status !== "done" && task.status !== "cancelled") backlog.push(task);
	}
	return backlog;
}
