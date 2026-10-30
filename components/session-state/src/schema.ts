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
	`alter table sessions add column spawned_by text;`,
	`create table commands (
		command_id text primary key,
		session_id text not null,
		generation integer,
		kind text not null,
		command text not null,
		stage text not null,
		reason text,
		created_at integer not null,
		updated_at integer not null
	) strict;`,
	// Mail is a command; this view names its edges. A mail is delivered once applied (its transcript holds it).
	`create view mail as
		select command_id as id, json_extract(command, '$.from') as sender, session_id as receiver,
			json_extract(command, '$.body') as body, created_at as sent_at,
			case stage when 'applied' then updated_at end as delivered_at, stage, reason
		from commands where kind = 'mail';`,
	// Attention: when the operator last saw the session, when it last settled, and since when it needs the operator
	// (an open prompt, or a settle after the last seen time); null when it does not.
	`alter table sessions add column seen_at integer;
	alter table sessions add column settled_at integer;
	alter table sessions add column needs_you_since integer;`,
	// The incarnation a client bound a command to, kept apart from the one it was handed to: bound mail never waits for
	// a later incarnation.
	`alter table commands add column bound_generation integer;`,
	// Choices a view keeps across restarts (the notch's vibes, rooms, looks, and positions), as JSON by key.
	`create table preferences (
		key text primary key,
		value text not null,
		updated_at integer not null
	) strict;`,
	// What the session says it works on now (session-title's stated intent), shown when it has no ledger task.
	`alter table sessions add column intent text;`,
	// The role a hired person holds for life (the name of a role catalog file); null for an unroled session.
	`alter table sessions add column role text;`,
	`alter table sessions add column soul text;`,
	`alter table sessions add column self text;`,
	// A retired person: when and why it left; cleared when a manager reopens it. Every manager change, for the record.
	`alter table sessions add column retired_at integer;
	alter table sessions add column retired_reason text;
	create table manager_changes (
		id integer primary key autoincrement,
		session_id text not null,
		from_manager text,
		to_manager text not null,
		by text not null,
		at integer not null
	) strict;`,
	// The role's title, so views that read the database (sidebar, dashboard, Agent World) show it without the catalog.
	`alter table sessions add column role_title text;`,
	// Whether the role manages (1), does not (0), or the session has no role (null); views draw managers by it.
	`alter table sessions add column manages integer;`,
	// A subagent never needs the operator (its parent takes its result); clear what earlier runtimes set.
	`update sessions set needs_you_since = null where kind = 'child';`,
	// Threads: every exchange between people. A participant is a session id or the operator; a pushed participant
	// gets each new message as mail, a pulled one reads it when it chooses. Messages are ordered by `seq`.
	`create table threads (
		id text primary key,
		kind text not null,
		subject text not null,
		created_by text not null,
		created_at integer not null,
		closed_at integer
	) strict;
	create table thread_participants (
		thread_id text not null,
		participant text not null,
		delivery text not null,
		read_up_to integer not null,
		joined_at integer not null,
		primary key (thread_id, participant)
	) strict;
	create index thread_participants_by_participant on thread_participants (participant);
	create table thread_messages (
		seq integer primary key autoincrement,
		id text not null unique,
		thread_id text not null,
		sender text not null,
		body text not null,
		at integer not null
	) strict;
	create index thread_messages_by_thread on thread_messages (thread_id, seq);`,
	// Team membership follows the tree; an explicit invitation survives a change of manager.
	`alter table thread_participants add column invited integer not null default 0;`,
	`create table work_tasks (
		id text primary key,
		bundle text not null unique,
		project text not null,
		organization text not null,
		ephemeral integer not null,
		thread text not null unique,
		archived_at integer
	) strict;
	create table assignments (
		id integer primary key autoincrement,
		person text not null,
		task_id text not null,
		assigned_by text not null,
		assigned_at integer not null,
		ended_at integer,
		outcome text,
		end_reason text
	) strict;
	create unique index held_assignment on assignments(person, task_id) where ended_at is null;
	create index assignments_by_task on assignments(task_id);
	create table work_focus (person text primary key, task_id text not null) strict;
	create table work_changes (
		command_id text primary key,
		task_id text not null,
		person text not null,
		action text not null,
		previous_bundle text
	) strict;`,
	// A program owns a launch before the person or process exists. Creation ancestry is not the reporting tree.
	`create table program_scopes (
		id text primary key,
		caller text not null,
		parent text,
		closing integer not null default 0,
		last_error text
	) strict;
	create table program_peers (
		session_id text primary key,
		program_id text not null,
		created_by text not null,
		task_id text not null,
		socket text,
		pane text,
		pid integer,
		process_started_at integer
	) strict;
	create index peers_by_program on program_peers(program_id);
	alter table commands add column program_id text;
	create index commands_by_program on commands(program_id) where program_id is not null;`,
	// When a task became the organization's obligation, and how it closed; `archived_at` is when it closed.
	// A task recorded before this column opened when it was first assigned, the first time the runtime recorded it.
	`alter table work_tasks add column opened_at integer;
	alter table work_tasks add column close_status text;
	update work_tasks set opened_at = (select min(assigned_at) from assignments where task_id = work_tasks.id);
	update work_tasks set close_status = 'done' where ephemeral = 1 and archived_at is not null;`,
	// Relationships between work, people, and results; the relation comes from the vocabulary in relations.json.
	`create table links (
		id text primary key,
		from_kind text not null,
		from_id text not null,
		to_kind text not null,
		to_id text not null,
		relation text not null,
		reason text,
		data text,
		recorded_by text not null,
		inferred integer not null,
		confidence real,
		created_at integer not null,
		resolved_at integer,
		resolution text
	) strict;
	create index links_by_target on links (to_kind, to_id);`,
	`alter table links add column organization text;`,
	`insert into events (at, source, session_id, type, data)
	 select joined_at, 'migration', participant, 'thread_joined', json_object('thread', thread_id)
	 from thread_participants;
	 insert into events (at, source, session_id, type, data)
	 values (cast(unixepoch('subsec') * 1000 as integer), 'migration', 'runtime', 'thread_participation_tracking', '{}');`,
	`insert into events (at, source, session_id, type, data)
	 select cast(unixepoch('subsec') * 1000 as integer), 'migration', p.session_id, 'program_peer_observed', json_object('caller', p.created_by)
	 from program_peers p
	 where not exists (select 1 from events e where e.session_id = p.session_id and e.type in ('program_peer_created', 'program_peer_observed'));`,
	`create index events_by_type on events (type, seq);`,
	// When a manager-tool hire first connected. Null is unknown, including every person recorded before this column.
	`alter table sessions add column hired_at integer;`,
	`alter table sessions add column specialization text;`,
	`alter table threads add column channel_type text;
	 alter table threads add column purpose text;
	 alter table threads add column scope_head text;
	 alter table threads add column pinned_seq integer;
	 alter table thread_participants add column following integer not null default 1;
	 alter table commands add column result text;
	 update threads set channel_type = case when id like 'organization:%' then 'organization' else 'team' end
	 where kind = 'channel';
	 update threads set scope_head = case when id like 'organization:%' then substr(id, 14) when id like 'team:%' then substr(id, 6) else created_by end where kind = 'channel';`,
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
