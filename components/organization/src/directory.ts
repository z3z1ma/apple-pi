/**
 * The organization a session belongs to, read from the session-state database: the tree of `reports_to` that ends
 * at one root (a top-level session with no manager). Everyone in the tree is a member, awake or asleep; sessions in
 * other trees are other organizations.
 */

import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { statePaths } from "../../session-state/src/paths.js";

export interface Member {
	id: string;
	name: string | null;
	/** The role catalog name, or null for an unroled session. */
	role: string | null;
	/** One line of the soul drawn at hire, or null without a role. */
	soul: string | null;
	/** The manager's session id; null for the root. */
	reportsTo: string | null;
	status: "busy" | "idle" | "waiting" | "asleep";
	cwd: string;
	currentTask: string | null;
	/** Ledger task ids this session has touched, newest first. */
	tasks: string[];
	/** When the session first started (ms), or null when it never ran. */
	since: number | null;
	/** When and why the person left; null for a member. */
	retired: { at: number; reason: string } | null;
}

export interface Organization {
	root: string;
	/** Every member but `self`: the root first, then by manager and name. */
	members: Member[];
}

interface Row {
	id: string;
	name: string | null;
	role: string | null;
	soul: string | null;
	reports_to: string | null;
	cwd: string;
	run_state: string;
	prompt: string | null;
	task: string | null;
	awake: number | null;
	since: number | null;
	retired_at: number | null;
	retired_reason: string | null;
}

/**
 * The organization's columns of `sessions` as select terms, each null when the running runtime predates it: the
 * runtime migrates the schema only when it starts, and a bridge of newer code can connect to an older runtime.
 */
export function organizationColumns(
	db: DatabaseSync,
	names = ["role", "soul", "retired_at", "retired_reason"],
): string {
	const columns = new Set(
		(db.prepare("select name from pragma_table_info('sessions')").all() as { name: string }[]).map((c) => c.name),
	);
	return names.map((name) => (columns.has(name) ? `s.${name}` : `null as ${name}`)).join(", ");
}

/** The root of the tree `id` is in, following managers up and stopping at a cycle. */
function rootOf(id: string, managerOf: Map<string, string | null>): string {
	const seen = new Set<string>();
	let current = id;
	while (!seen.has(current)) {
		seen.add(current);
		const manager = managerOf.get(current);
		if (!manager || !managerOf.has(manager)) return current;
		current = manager;
	}
	return current;
}

/** The organization of `self`: its root and every other member, or `self` alone when the database is unreadable. */
export function organizationOf(self: string): Organization {
	const path = statePaths().db;
	if (!existsSync(path)) return { root: self, members: [] };
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		const rows = db
			.prepare(
				`select s.id, s.name, ${organizationColumns(db)}, s.reports_to, s.cwd, s.run_state, s.prompt,
					json_extract(s.current_task, '$.taskId') as task,
					i.ended_at is null and i.process_state in ('alive', 'alive_bridge_lost') as awake,
					(select min(f.started_at) from incarnations f where f.session_id = s.id) as since
				from sessions s left join incarnations i on i.session_id = s.id and i.generation = s.generation
				where s.kind = 'root'
				order by s.reports_to, s.name`,
			)
			.all() as unknown as Row[];
		const managerOf = new Map(rows.map((row) => [row.id, row.reports_to]));
		if (!managerOf.has(self)) managerOf.set(self, null);
		const root = rootOf(self, managerOf);
		const tasks = db.prepare("select distinct task_id from session_tasks where session_id = ? order by at desc");
		const members: Member[] = rows
			.filter((row) => row.id !== self && rootOf(row.id, managerOf) === root)
			.map((row) => ({
				id: row.id,
				name: row.name,
				role: row.role,
				soul: row.soul,
				reportsTo: row.reports_to,
				status: !row.awake ? "asleep" : row.prompt ? "waiting" : row.run_state === "idle" ? "idle" : "busy",
				cwd: row.cwd,
				currentTask: row.task,
				tasks: (tasks.all(row.id) as { task_id: string }[]).map((t) => t.task_id),
				since: row.since,
				retired: row.retired_at ? { at: row.retired_at, reason: row.retired_reason ?? "" } : null,
			}));
		return { root, members };
	} finally {
		db.close();
	}
}
