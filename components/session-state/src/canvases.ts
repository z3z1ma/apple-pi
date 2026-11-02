// The operator's canvases: his own documents, like Slack canvases or Notion pages, kept as Markdown so the desk and
// the scout can read them and, when he asks, write in them. Every write names the version it started from; a write
// against an older version is refused with the current text, so his typing and an agent's edit never overwrite each
// other silently.
import type { DatabaseSync } from "node:sqlite";

export interface CanvasSummary {
	id: string;
	title: string;
	/** The first words of the body, for lists. */
	preview: string;
	by: string;
	createdAt: number;
	updatedAt: number;
	updatedBy: string;
	version: number;
	pinned: boolean;
}
export interface Canvas extends CanvasSummary {
	body: string;
}

interface Row {
	id: string;
	title: string;
	body: string;
	by: string;
	created_at: number;
	updated_at: number;
	updated_by: string;
	version: number;
	pinned: number;
}

const summary = (row: Omit<Row, "body"> & { preview: string }): CanvasSummary => ({
	id: row.id,
	title: row.title,
	preview: row.preview
		.replace(/[#>*_`[\]-]+/g, " ")
		.replace(/\s+/g, " ")
		.trim(),
	by: row.by,
	createdAt: row.created_at,
	updatedAt: row.updated_at,
	updatedBy: row.updated_by,
	version: row.version,
	pinned: row.pinned === 1,
});

export const canvasesAvailable = (db: DatabaseSync) =>
	Boolean(db.prepare("select 1 from sqlite_master where name = 'canvases'").get());

/** Canvases newest first, pinned ones before the rest; bodies stay unread except for a short preview. */
export function listCanvases(
	db: DatabaseSync,
	filter: { words?: string; limit: number; before?: number },
): CanvasSummary[] {
	const where = ["1 = 1"];
	const args: (string | number)[] = [];
	for (const word of (filter.words ?? "").toLowerCase().split(/\s+/).filter(Boolean)) {
		where.push("lower(title || ' ' || body) like ?");
		args.push(`%${word}%`);
	}
	if (filter.before !== undefined) where.push("updated_at < ?") && args.push(filter.before);
	return (
		db
			.prepare(
				`select id, title, substr(body, 1, 200) as preview, by, created_at, updated_at, updated_by, version, pinned
				from canvases where ${where.join(" and ")} order by pinned desc, updated_at desc, id limit ?`,
			)
			.all(...args, filter.limit) as unknown as (Omit<Row, "body"> & { preview: string })[]
	).map(summary);
}

export function readCanvas(db: DatabaseSync, id: string): Canvas | undefined {
	const row = db.prepare("select * from canvases where id = ?").get(id) as Row | undefined;
	return row ? { ...summary({ ...row, preview: row.body.slice(0, 200) }), body: row.body } : undefined;
}

export type CanvasWrite =
	| { create: { title: string; body?: string } }
	| { update: string; base: number; title?: string; body?: string; pinned?: boolean }
	| { remove: string };

/** Apply a write; an update against a version other than the current one throws with the canvas as it is now. */
export function writeCanvas(db: DatabaseSync, id: string, by: string, write: CanvasWrite, now: number): number {
	if ("remove" in write) {
		if (db.prepare("delete from canvases where id = ?").run(write.remove).changes === 0)
			throw new Error(`No canvas ${write.remove}.`);
		return 0;
	}
	if ("create" in write) {
		db.prepare(
			`insert into canvases (id, title, body, by, created_at, updated_at, updated_by, version, pinned)
			values (?, ?, ?, ?, ?, ?, ?, 1, 0) on conflict (id) do nothing`,
		).run(id, write.create.title.trim() || "Untitled", write.create.body ?? "", by, now, now, by);
		return 1;
	}
	const current = readCanvas(db, write.update);
	if (!current) throw new Error(`No canvas ${write.update}.`);
	if (current.version !== write.base)
		throw new Error(
			`Canvas changed since version ${write.base}: it is at version ${current.version}, last written by ${current.updatedBy}. Read it again and apply your change to that.`,
		);
	db.prepare(
		"update canvases set title = ?, body = ?, pinned = ?, updated_at = ?, updated_by = ?, version = version + 1 where id = ?",
	).run(
		write.title?.trim() || current.title,
		write.body ?? current.body,
		write.pinned === undefined ? (current.pinned ? 1 : 0) : write.pinned ? 1 : 0,
		now,
		by,
		write.update,
	);
	return current.version + 1;
}
