import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { statePaths } from "../../session-state/src/paths.js";
import { type AssignedTask, workOf } from "../../session-state/src/work-read.js";

export interface Member {
	id: string;
	name: string | null;
	role: string | null;
	title: string | null;
	soul: string | null;
	reportsTo: string | null;
	status: "busy" | "idle" | "waiting" | "at home";
	cwd: string;
	tasks: AssignedTask[];
	focus: AssignedTask | null;
	record: AssignedTask[];
	since: number | null;
	retired: { at: number; reason: string } | null;
}

export interface Organization {
	root: string;
	members: Member[];
}

interface Row {
	id: string;
	name: string | null;
	role: string | null;
	role_title: string | null;
	soul: string | null;
	reports_to: string | null;
	cwd: string;
	run_state: string;
	prompt: string | null;
	awake: number | null;
	since: number | null;
	retired_at: number | null;
	retired_reason: string | null;
}

export function organizationColumns(
	db: DatabaseSync,
	names = ["role", "role_title", "soul", "retired_at", "retired_reason"],
): string {
	const columns = new Set(
		(db.prepare("select name from pragma_table_info('sessions')").all() as { name: string }[]).map((c) => c.name),
	);
	return names.map((name) => (columns.has(name) ? `s.${name}` : `null as ${name}`)).join(", ");
}

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

export function reportingOf(id: string): { id: string; reportsTo: string | null } | undefined {
	const path = statePaths().db;
	if (!existsSync(path)) return undefined;
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		return db.prepare("select id, reports_to as reportsTo from sessions where id = ?").get(id) as
			| { id: string; reportsTo: string | null }
			| undefined;
	} finally {
		db.close();
	}
}

export function specializationOf(id: string): string | null {
	const path = statePaths().db;
	if (!existsSync(path)) return null;
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		const row = db
			.prepare(`select ${organizationColumns(db, ["specialization"])} from sessions s where s.id = ?`)
			.get(id) as { specialization: string | null } | undefined;
		return row?.specialization ?? null;
	} finally {
		db.close();
	}
}

export function organizationOf(self: string, includeSelf = false): Organization {
	const path = statePaths().db;
	if (!existsSync(path)) return { root: self, members: [] };
	const db = new DatabaseSync(path, { readOnly: true });
	try {
		return organizationIn(db, self, includeSelf);
	} finally {
		db.close();
	}
}

export function organizationIn(db: DatabaseSync, self: string, includeSelf = false): Organization {
	const rows = db
		.prepare(
			`select s.id, s.name, ${organizationColumns(db)}, s.reports_to, s.cwd, s.run_state, s.prompt,
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
	const members: Member[] = rows
		.filter((row) => (includeSelf || row.id !== self) && rootOf(row.id, managerOf) === root)
		.map((row) => ({
			id: row.id,
			name: row.name,
			role: row.role,
			title: row.role_title,
			soul: row.soul,
			reportsTo: row.reports_to,
			status: !row.awake ? "at home" : row.prompt ? "waiting" : row.run_state === "idle" ? "idle" : "busy",
			cwd: row.cwd,
			...workOf(db, row.id),
			since: row.since,
			retired: row.retired_at ? { at: row.retired_at, reason: row.retired_reason ?? "" } : null,
		}));
	return { root, members };
}
