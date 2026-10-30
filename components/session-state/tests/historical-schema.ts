import type { DatabaseSync } from "node:sqlite";

/** Remove physical changes since v29; each older fixture removes its own earlier columns/data. */
export function rewindRecentSchema(db: DatabaseSync, version: number): void {
	const columns = [
		[31, "sessions", "hired_at"],
		[32, "sessions", "specialization"],
		[33, "threads", "channel_type"],
		[33, "threads", "purpose"],
		[33, "threads", "scope_head"],
		[33, "threads", "pinned_seq"],
		[33, "thread_participants", "following"],
		[33, "commands", "result"],
	] as const;
	for (const [introduced, table, column] of columns)
		if (introduced > version) db.exec(`alter table ${table} drop column ${column}`);
	if (version < 30) db.exec("drop index events_by_type");
	db.exec(`pragma user_version = ${version}`);
}
