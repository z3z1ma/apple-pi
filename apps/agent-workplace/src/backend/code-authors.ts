import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface CodeAuthor {
	id: string;
	name: string;
	editedAt: number;
}

function absolute(cwd: string, path: string): string {
	return path.startsWith("~") ? join(homedir(), path.slice(1)) : resolve(cwd, path);
}

export function lastEditor(dbPath: string, file: string): CodeAuthor | null {
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const rows = db
			.prepare(
				`select m.session_id, m.at, m.preview, s.cwd, s.name from messages m join sessions s on s.id = m.session_id
				where m.part <> '' and m.tool in ('edit', 'write') and s.retired_at is null
				order by m.at desc`,
			)
			.all() as { session_id: string; at: number; preview: string; cwd: string; name: string | null }[];
		const row = rows.find((candidate) => absolute(candidate.cwd, candidate.preview) === file);
		return row ? { id: row.session_id, name: row.name ?? row.session_id.slice(0, 8), editedAt: row.at } : null;
	} finally {
		db.close();
	}
}
