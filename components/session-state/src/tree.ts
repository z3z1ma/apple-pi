import type { DatabaseSync } from "node:sqlite";

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

export function taskOrganization(db: DatabaseSync, task: string): string | undefined {
	const row = db.prepare("select organization from work_tasks where id = ?").get(task) as
		| { organization: string }
		| undefined;
	return row && rootOf(db, row.organization);
}

export function anchorsOf(db: DatabaseSync, organization: string): string[] {
	const recorded = (db.prepare("select distinct organization from work_tasks").all() as { organization: string }[]).map(
		(row) => row.organization,
	);
	return [...new Set([organization, ...recorded.filter((anchor) => rootOf(db, anchor) === organization)])];
}
