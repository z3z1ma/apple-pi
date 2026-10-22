import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { syncChannels } from "./channels.js";
import { cleanMovedBundles } from "./work.js";

interface Person {
	id: string;
	reports_to: string | null;
	program_parent: string | null;
}

/** Include temporary people created by these people, even if someone moved them to another team. */
export function programDescendants(db: DatabaseSync, roots: Iterable<string>): Set<string> {
	const people = db.prepare("select session_id as id, created_by as program_parent from program_peers").all() as Pick<
		Person,
		"id" | "program_parent"
	>[];
	const result = new Set(roots);
	for (let previous = -1; previous !== result.size; ) {
		previous = result.size;
		for (const person of people) if (person.program_parent && result.has(person.program_parent)) result.add(person.id);
	}
	return result;
}

/** All processes are proven gone before this runs. Keep shared work and lasting people; keep every Pi transcript. */
export function discardProgramPeople(
	db: DatabaseSync,
	stateDir: string,
	ids: Set<string>,
	now: number,
): { person: string; manager: string }[] {
	if (!ids.size) return [];
	const people = db
		.prepare(
			"select s.id, s.reports_to, p.created_by as program_parent from sessions s left join program_peers p on p.session_id = s.id",
		)
		.all() as unknown as Person[];
	const owned = db.prepare("select session_id, task_id from program_peers").all() as {
		session_id: string;
		task_id: string;
	}[];
	const byId = new Map(people.map((person) => [person.id, person]));
	const gone = new Set(owned.filter((person) => ids.has(person.session_id)).map((person) => person.session_id));
	const replacement = (id: string): string | undefined => {
		const seen = new Set<string>();
		let person = byId.get(id);
		while (person && gone.has(person.id) && !seen.has(person.id)) {
			seen.add(person.id);
			person = byId.get(person.reports_to ?? person.program_parent ?? "");
		}
		return person && !gone.has(person.id) ? person.id : undefined;
	};
	const transfers: { person: string; manager: string }[] = [];
	db.exec("begin");
	try {
		for (const person of people) {
			if (gone.has(person.id) || !person.reports_to || !gone.has(person.reports_to)) continue;
			const manager = replacement(person.reports_to);
			if (!manager) throw new Error(`No surviving manager for ${person.id}`);
			db.prepare("update sessions set reports_to = ?, updated_at = ? where id = ?").run(manager, now, person.id);
			db.prepare(
				"insert into manager_changes (session_id, from_manager, to_manager, by, at) values (?, ?, ?, ?, ?)",
			).run(person.id, person.reports_to, manager, "runtime", now);
			transfers.push({ person: person.id, manager });
		}
		const tasks = db.prepare("select id, bundle, ephemeral, thread from work_tasks").all() as {
			id: string;
			bundle: string;
			ephemeral: number;
			thread: string;
		}[];
		for (const task of tasks) {
			const assignees = db.prepare("select distinct person from assignments where task_id = ?").all(task.id) as {
				person: string;
			}[];
			if (!assignees.some(({ person }) => gone.has(person))) continue;
			if (task.ephemeral && assignees.every(({ person }) => gone.has(person))) {
				db.prepare(
					"insert into work_changes (command_id, task_id, person, action, previous_bundle) values (?, ?, ?, 'discard', ?)",
				).run(randomUUID(), task.id, assignees[0]!.person, task.bundle);
				for (const table of ["assignments", "work_focus", "work_changes"]) {
					if (table === "work_changes")
						db.prepare("delete from work_changes where task_id = ? and action != 'discard'").run(task.id);
					else db.prepare(`delete from ${table} where task_id = ?`).run(task.id);
				}
				db.prepare("delete from work_tasks where id = ?").run(task.id);
				db.prepare("delete from thread_participants where thread_id = ?").run(task.thread);
				db.prepare("delete from thread_messages where thread_id = ?").run(task.thread);
				db.prepare("delete from threads where id = ?").run(task.thread);
			}
		}
		for (const peer of owned) {
			if (!gone.has(peer.session_id) || db.prepare("select 1 from work_tasks where id = ?").get(peer.task_id)) continue;
			const bundle = join(stateDir, "tasks", peer.task_id);
			if (
				existsSync(bundle) &&
				!db.prepare("select 1 from work_changes where task_id = ? and action = 'discard'").get(peer.task_id)
			)
				db.prepare(
					"insert into work_changes (command_id, task_id, person, action, previous_bundle) values (?, ?, ?, 'discard', ?)",
				).run(randomUUID(), peer.task_id, peer.session_id, bundle);
		}
		for (const id of gone) {
			const manager = replacement(id);
			if (manager)
				db.prepare(`insert into thread_participants (thread_id, participant, delivery, read_up_to, joined_at)
				select p.thread_id, ?, 'push', 0, ? from thread_participants p join threads t on t.id = p.thread_id
				where p.participant = ? and t.kind = 'task' on conflict do nothing`).run(manager, now, id);
			db.prepare(
				"update threads set closed_at = ? where created_by = ? and kind in ('meeting', 'channel') and closed_at is null",
			).run(now, id);
			for (const [table, column] of [
				["assignments", "person"],
				["work_focus", "person"],
				["thread_participants", "participant"],
				["messages", "session_id"],
				["session_tasks", "session_id"],
				["manager_changes", "session_id"],
				["incarnations", "session_id"],
				["sessions", "id"],
			])
				db.prepare(`delete from ${table} where ${column} = ?`).run(id);
		}
		syncChannels(db, now);
		db.exec("commit");
	} catch (error) {
		db.exec("rollback");
		throw error;
	}
	// Reuse the work journal's crash-safe file cleanup: a crash after the commit leaves a retryable path.
	cleanMovedBundles(db);
	const pending = db
		.prepare(
			"select person, previous_bundle from work_changes where action = 'discard' and previous_bundle is not null",
		)
		.all() as { person: string; previous_bundle: string }[];
	const failed = pending.filter(({ person }) => ids.has(person));
	if (failed.length)
		throw new Error(`Could not discard task data: ${failed.map((row) => row.previous_bundle).join(", ")}`);
	for (const id of gone) db.prepare("delete from program_peers where session_id = ?").run(id);
	return transfers;
}
