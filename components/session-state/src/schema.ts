import type { DatabaseSync } from "node:sqlite";

// Forward migrations; index i takes the database from user_version i to i + 1. Never edit a shipped entry.
const MIGRATIONS = [
	`create table sessions (
		id text primary key,
		kind text not null,
		session_file text,
		cwd text not null,
		name text,
		run_state text not null,
		generation integer not null,
		source text not null,
		updated_at integer not null
	) strict;
	create table incarnations (
		session_id text not null,
		generation integer not null,
		pid integer not null,
		process_started_at integer not null,
		process_state text not null,
		started_at integer not null,
		ended_at integer,
		end_reason text,
		source text not null,
		updated_at integer not null,
		primary key (session_id, generation)
	) strict;
	create table events (
		seq integer primary key autoincrement,
		at integer not null,
		source text not null,
		session_id text,
		generation integer,
		type text not null,
		data text
	) strict;`,
];

export const SCHEMA_VERSION = MIGRATIONS.length;

export function migrate(db: DatabaseSync): void {
	const { user_version } = db.prepare("pragma user_version").get() as { user_version: number };
	for (let version = user_version; version < MIGRATIONS.length; version++) {
		db.exec("begin");
		db.exec(MIGRATIONS[version]);
		db.exec(`pragma user_version = ${version + 1}`);
		db.exec("commit");
	}
}
