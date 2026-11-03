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
		[36, "review_jobs", "selected_attempts"],
		[37, "review_attempts", "reuse_blocked_by"],
		[40, "sessions", "on_call"],
		[43, "threads", "listener"],
		[43, "threads", "charter"],
	] as const;
	for (const [introduced, table, column] of columns)
		if (introduced > version) db.exec(`alter table ${table} drop column ${column}`);
	if (version < 50) db.exec("drop index messages_by_time");
	if (version < 49) db.exec("drop table canvases");
	if (version < 48) db.exec("drop table notes");
	if (version < 47) db.exec("drop table activity_rules");
	if (version < 46) db.exec("drop table activity_items; drop table activity_cursors");
	else if (version < 47) db.exec("alter table activity_items drop column rule");
	if (version < 45) db.exec("drop table message_reactions");
	if (version < 42) db.exec("drop table external_seen; drop table external_sources; drop table external_policies");
	if (version < 41) db.exec("drop table schedules");
	if (version < 38) db.exec("drop table review_decisions");
	if (version < 30) db.exec("drop index events_by_type");
	if (version < 35) db.exec("drop table review_attempts");
	if (version < 34) db.exec("drop table review_jobs");
	db.exec(`pragma user_version = ${version}`);
}
