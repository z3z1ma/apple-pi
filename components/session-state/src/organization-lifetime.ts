import type { DatabaseSync } from "node:sqlite";
import { temporaryCallers } from "./program-peers.js";
import { rootOf } from "./tree.js";

export interface OrganizationLifetime {
	root: string;
	incorporated: boolean;
	closing: boolean;
	waiting: { person: string; reason: string }[];
}

export function dissolutionBlocker(db: DatabaseSync, person: string): string | undefined {
	const row = db
		.prepare(`select s.run_state, s.prompt, s.queue, s.retired_at,
		i.process_state, i.ended_at from sessions s left join incarnations i
		on i.session_id = s.id and i.generation = s.generation where s.id = ?`)
		.get(person) as
		| {
				run_state: string;
				prompt: string | null;
				queue: string | null;
				retired_at: number | null;
				process_state: string | null;
				ended_at: number | null;
		  }
		| undefined;
	if (!row) return "Person no longer exists";
	if (row.retired_at !== null) return "Finishing permanent departure resource cleanup";
	const alive = row.process_state === "alive" || row.process_state === "alive_bridge_lost";
	if (alive && (row.run_state !== "idle" || row.prompt || (row.queue && JSON.parse(row.queue).pending)))
		return "Waiting for the current turn or pending input to settle";
	if (db.prepare("select 1 from assignments where person = ? and ended_at is null").get(person))
		return "Waiting for held assignments to finish or be reassigned";
	if (
		db
			.prepare("select 1 from review_jobs where owner = ? and state not in ('completed', 'cancelled', 'no-changes')")
			.get(person)
	)
		return "Waiting for owned reviews to finish or be reassigned";
	if (db.prepare("select 1 from sessions where kind = 'root' and reports_to = ?").get(person))
		return "Waiting for reports to leave and finish resource cleanup";
	if (
		db.prepare("select 1 from program_scopes where caller = ?").get(person) ||
		db.prepare("select 1 from program_peers where created_by = ?").get(person)
	)
		return "Waiting for program delegations to finish cleanup";
	if (!db.prepare("select 1 from incarnations where session_id = ?").get(person))
		return "Waiting for an observed process identity before safe cleanup";
	return undefined;
}

export function organizationLifetime(db: DatabaseSync, person: string): OrganizationLifetime {
	const root = rootOf(db, person);
	const available = db.prepare("select 1 from pragma_table_info('sessions') where name = 'incorporated'").get();
	if (!available) return { root, incorporated: true, closing: false, waiting: [] };
	const row = db
		.prepare("select incorporated, closing_generation, generation from sessions where id = ? and kind = 'root'")
		.get(root) as { incorporated: number; closing_generation: number | null; generation: number } | undefined;
	if (!row) throw new Error("Unknown organization");
	const closing = !row.incorporated && row.closing_generation === row.generation;
	const waiting: OrganizationLifetime["waiting"] = [];
	if (closing) {
		const temporary = temporaryCallers(db);
		for (const { id } of db.prepare("select id from sessions where kind = 'root' order by id").all() as {
			id: string;
		}[]) {
			if (rootOf(db, id) !== root) continue;
			const reason = temporary.has(id)
				? "Waiting for the owning program to dispose its temporary peer"
				: dissolutionBlocker(db, id);
			waiting.push({ person: id, reason: reason ?? "Ready for permanent departure" });
		}
	}
	return { root, incorporated: row.incorporated === 1, closing, waiting };
}

export function incorporateOrganization(db: DatabaseSync, person: string, by: string): void {
	const root = rootOf(db, person);
	const row = db
		.prepare("select incorporated, closing_generation, retired_at from sessions where id = ? and kind = 'root'")
		.get(root) as { incorporated: number; closing_generation: number | null; retired_at: number | null } | undefined;
	if (!row || row.retired_at !== null) throw new Error("Unknown or departed organization");
	if (row.incorporated === 1 && row.closing_generation === null) return;
	const now = Date.now();
	db.prepare("update sessions set incorporated = 1, closing_generation = null, updated_at = ? where id = ?").run(
		now,
		root,
	);
	db.prepare(
		"insert into events (at, source, session_id, generation, type, data) values (?, 'runtime', ?, null, 'organization_incorporated', ?)",
	).run(now, root, JSON.stringify({ by }));
}

export function requireDissolution(db: DatabaseSync, person: string, root: string, generation: number): void {
	const current = db
		.prepare(`select 1 from sessions where id = ? and reports_to is null
		and incorporated = 0 and closing_generation = ? and generation = ?`)
		.get(root, generation, generation);
	if (!current || rootOf(db, person) !== root)
		throw new Error("The organization's closing request is no longer current");
	const reason = dissolutionBlocker(db, person);
	if (reason) throw new Error(reason);
}
