// The organization's notes: durable knowledge that outlives one task (who owns what, how a system works, which
// threads are about the same thing), written by the scout and the desk, readable by them and shown to the operator.
// A connection is a note whose refs name the things it connects: outside activity items, links, tasks and threads.
import type { DatabaseSync } from "node:sqlite";

export interface Note {
	id: string;
	title: string;
	body: string;
	/** Short words to find it by: a system, a team, a customer. */
	topics: string[];
	/** What it is about: activity item ids, URLs, task ids, thread ids. */
	refs: string[];
	by: string;
	createdAt: number;
	updatedAt: number;
}

interface Row {
	id: string;
	title: string;
	body: string;
	topics: string;
	refs: string;
	by: string;
	created_at: number;
	updated_at: number;
}

const note = (row: Row): Note => ({
	id: row.id,
	title: row.title,
	body: row.body,
	topics: JSON.parse(row.topics) as string[],
	refs: JSON.parse(row.refs) as string[],
	by: row.by,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
});

export const notesAvailable = (db: DatabaseSync) =>
	Boolean(db.prepare("select 1 from sqlite_master where name = 'notes'").get());

/** Write a new note (`id` is its new id) or replace the fields given of an existing one (`update`). */
export function writeNote(
	db: DatabaseSync,
	id: string,
	by: string,
	input: { update?: string; title?: string; body?: string; topics?: string[]; refs?: string[] },
	now: number,
): string {
	const clean = (values: string[] | undefined) => [
		...new Set((values ?? []).map((value) => value.trim()).filter(Boolean)),
	];
	if (input.update) {
		const row = db.prepare("select * from notes where id = ?").get(input.update) as Row | undefined;
		if (!row) throw new Error(`No note ${input.update}.`);
		const current = note(row);
		db.prepare("update notes set title = ?, body = ?, topics = ?, refs = ?, updated_at = ? where id = ?").run(
			input.title?.trim() || current.title,
			input.body?.trim() || current.body,
			JSON.stringify(input.topics ? clean(input.topics) : current.topics),
			JSON.stringify(input.refs ? clean(input.refs) : current.refs),
			now,
			input.update,
		);
		return input.update;
	}
	if (!input.title?.trim() || !input.body?.trim()) throw new Error("A new note needs a title and a body.");
	db.prepare(
		"insert into notes (id, title, body, topics, refs, by, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?) on conflict (id) do nothing",
	).run(
		id,
		input.title.trim(),
		input.body.trim(),
		JSON.stringify(clean(input.topics)),
		JSON.stringify(clean(input.refs)),
		by,
		now,
		now,
	);
	return id;
}

export function removeNote(db: DatabaseSync, id: string): void {
	if (db.prepare("delete from notes where id = ?").run(id).changes === 0) throw new Error(`No note ${id}.`);
}

/** Notes newest first; `words` must all appear in the title, body or topics, `ref` among its refs. */
export function readNotes(db: DatabaseSync, filter: { words?: string; ref?: string; limit: number }): Note[] {
	const where = ["1 = 1"];
	const args: string[] = [];
	for (const word of (filter.words ?? "").toLowerCase().split(/\s+/).filter(Boolean)) {
		where.push("lower(title || ' ' || body || ' ' || topics) like ?");
		args.push(`%${word}%`);
	}
	if (filter.ref) {
		where.push("exists (select 1 from json_each(notes.refs) where value = ?)");
		args.push(filter.ref);
	}
	return (
		db
			.prepare(`select * from notes where ${where.join(" and ")} order by updated_at desc, id limit ?`)
			.all(...args, filter.limit) as unknown as Row[]
	).map(note);
}
