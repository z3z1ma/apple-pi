import type { DatabaseSync } from "node:sqlite";

/** The root of the organization `person` belongs to, following recorded managers up; a missing manager ends the climb. */
export function rootOf(db: DatabaseSync, person: string): string {
	const seen = new Set<string>();
	let root = person;
	while (!seen.has(root)) {
		seen.add(root);
		const row = db.prepare("select reports_to from sessions where id = ?").get(root) as
			| { reports_to: string | null }
			| undefined;
		if (!row?.reports_to || !db.prepare("select 1 from sessions where id = ?").get(row.reports_to)) return root;
		root = row.reports_to;
	}
	throw new Error("The organization has a cycle");
}

/**
 * The organization a task belongs to now: the current root of the organization that recorded it. A merge (a root that
 * takes a manager) brings its work along, as it brings its knowledge.
 */
export function taskOrganization(db: DatabaseSync, task: string): string | undefined {
	const row = db.prepare("select organization from work_tasks where id = ?").get(task) as
		| { organization: string }
		| undefined;
	return row && rootOf(db, row.organization);
}

/** The recorded organizations whose tasks now belong to `organization`: itself and every root that has joined it. */
export function anchorsOf(db: DatabaseSync, organization: string): string[] {
	const recorded = (db.prepare("select distinct organization from work_tasks").all() as { organization: string }[]).map(
		(row) => row.organization,
	);
	return [...new Set([organization, ...recorded.filter((anchor) => rootOf(db, anchor) === organization)])];
}
