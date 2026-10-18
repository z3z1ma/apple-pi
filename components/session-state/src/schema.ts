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
	`create table tmux_servers (
		socket text primary key,
		source text not null,
		updated_at integer not null
	) strict;
	create table tmux_sessions (
		socket text not null,
		id text not null,
		name text not null,
		source text not null,
		updated_at integer not null,
		primary key (socket, id)
	) strict;
	create table tmux_windows (
		socket text not null,
		id text not null,
		name text not null,
		source text not null,
		updated_at integer not null,
		primary key (socket, id)
	) strict;
	create table tmux_window_links (
		socket text not null,
		id text not null,
		session_id text not null,
		window_id text not null,
		window_index integer not null,
		source text not null,
		updated_at integer not null,
		primary key (socket, id)
	) strict;
	create table tmux_panes (
		socket text not null,
		id text not null,
		window_id text not null,
		tty text not null,
		pid integer not null,
		current_command text not null,
		current_path text not null,
		active integer not null,
		dead integer not null,
		source text not null,
		updated_at integer not null,
		primary key (socket, id)
	) strict;
	alter table incarnations add column tmux_socket text;
	alter table incarnations add column pane_id text;
	alter table incarnations add column pane_tty text;`,
	`alter table sessions add column current_tool text;
	alter table sessions add column current_tool_id text;
	alter table sessions add column current_tool_arg text;
	alter table sessions add column current_tool_since integer;
	alter table sessions add column model text;
	alter table sessions add column thinking_level text;
	alter table sessions add column context_tokens integer;
	alter table sessions add column context_window integer;
	alter table sessions add column cost real not null default 0;
	alter table sessions add column prompt text;
	alter table sessions add column queue text;
	alter table sessions add column last_error text;
	alter table sessions add column last_abort_at integer;
	alter table sessions add column config text;`,
	`create table messages (
		session_id text not null,
		entry_id text not null,
		part text not null,
		at integer not null,
		role text not null,
		tool text,
		size integer not null,
		preview text not null,
		source text not null,
		primary key (session_id, entry_id, part)
	) strict;`,
	// `at` is when the transcript entry was written; `observed_at` is when the runtime first indexed it.
	`alter table messages add column observed_at integer;`,
	`alter table sessions add column reports_to text;
	alter table sessions add column parent_session_file text;
	alter table sessions add column parent_session_id text;
	alter table sessions add column previous_session text;
	alter table sessions add column previous_session_id text;
	alter table sessions add column git text;
	alter table sessions add column current_task text;
	create table session_tasks (
		id integer primary key autoincrement,
		session_id text not null,
		generation integer not null,
		bundle text not null,
		task_id text not null,
		via text not null,
		at integer not null,
		source text not null
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
