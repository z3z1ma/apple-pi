import type { DatabaseSync } from "node:sqlite";
import { departureOf } from "./departures.js";

export function rootOf(db: DatabaseSync, person: string, reporting?: ReadonlyMap<string, string | null>): string {
	const seen = new Set<string>();
	let root = person;
	let previous = person;
	while (!seen.has(root)) {
		seen.add(root);
		const row = reporting?.has(root)
			? { reports_to: reporting.get(root)! }
			: (db.prepare("select reports_to from sessions where id = ?").get(root) as
					| { reports_to: string | null }
					| undefined);
		const manager = row ? row.reports_to : departureOf(db, root)?.reportsTo;
		if (manager === undefined) return previous;
		if (manager === null) return root;
		previous = root;
		root = manager;
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
