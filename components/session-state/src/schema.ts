import type { DatabaseSync } from "node:sqlite";

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

	`create view mail as
		select command_id as id, json_extract(command, '$.from') as sender, session_id as receiver,
			json_extract(command, '$.body') as body, created_at as sent_at,
			case stage when 'applied' then updated_at end as delivered_at, stage, reason
		from commands where kind = 'mail';`,

	`alter table sessions add column seen_at integer;
	alter table sessions add column settled_at integer;
	alter table sessions add column needs_you_since integer;`,

	`alter table commands add column bound_generation integer;`,

	`create table preferences (
		key text primary key,
		value text not null,
		updated_at integer not null
	) strict;`,

	`alter table sessions add column intent text;`,

	`alter table sessions add column role text;`,
	`alter table sessions add column soul text;`,
	`alter table sessions add column self text;`,

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

	`alter table sessions add column role_title text;`,

	`alter table sessions add column manages integer;`,

	`update sessions set needs_you_since = null where kind = 'child';`,

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

	`alter table work_tasks add column opened_at integer;
	alter table work_tasks add column close_status text;
	update work_tasks set opened_at = (select min(assigned_at) from assignments where task_id = work_tasks.id);
	update work_tasks set close_status = 'done' where ephemeral = 1 and archived_at is not null;`,

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
	`create table review_jobs (
		id text primary key,
		command_id text not null unique,
		requester text not null,
		owner text not null,
		organization text not null,
		origin_task text,
		parent text,
		state text not null,
		priority real not null default 0,
		generation integer not null default 0,
		revision integer not null default 0,
		plan_revision integer not null default 0,
		request text not null,
		artifact_directory text not null,
		artifact text,
		plan text,
		reason text,
		created_at integer not null,
		updated_at integer not null
	) strict;
	create index review_jobs_by_state on review_jobs(state, priority desc, created_at);`,
	`create table review_attempts (
		id text primary key,
		review_id text not null,
		generation integer not null,
		plan_revision integer not null,
		pass_id text not null,
		kind text not null,
		program_id text not null unique,
		person text not null unique,
		role text not null,
		policy text not null,
		input text not null,
		input_key text not null,
		state text not null,
		model text,
		thinking text,
		session_file text,
		result text,
		output text,
		reason text,
		created_at integer not null,
		finished_at integer
	) strict;
	create index review_attempts_by_review on review_attempts(review_id, plan_revision, pass_id, created_at);`,
	`alter table review_jobs add column selected_attempts text not null default '{}';`,
	`alter table review_attempts add column reuse_blocked_by text;`,
	`create table review_decisions (
		id text primary key,
		review_id text not null,
		digest text not null,
		revision integer not null,
		actor text not null,
		kind text not null,
		finding text,
		data text not null,
		created_at integer not null
	) strict;
	create index review_decisions_by_review on review_decisions(review_id, created_at);`,
	`alter table review_jobs add column additional_work text not null default '[]';`,

	`alter table sessions add column on_call integer;`,

	`create table schedules (
		id text primary key,
		owner text not null,
		target text not null,
		body text not null,
		next_at integer not null,
		every_ms integer,
		created_at integer not null,
		cancelled_at integer,
		last_fired_at integer
	) strict;
	create index schedules_due on schedules(cancelled_at, next_at);`,
	`create table external_sources (
		id text primary key,
		provider text not null,
		url text not null,
		repo text,
		number text,
		since integer not null,
		state text not null,
		events text
	) strict;
	create table external_seen (source text not null, event text not null, primary key (source, event)) strict;
	create table external_policies (provider text primary key, policy text not null, ignore_bots integer not null, last_error text) strict;
	insert into external_policies (provider, policy, ignore_bots) values ('github', 'candidate', 1), ('jira', 'explicit', 1);`,

	`alter table threads add column listener text;
	alter table threads add column charter text;`,

	`update threads set subject = 'Departure: ' || (
		select json_extract(e.data, '$.name') from events e
		where e.type = 'person_departed' and e.session_id = substr(threads.subject, 12)
			and json_extract(e.data, '$.name') is not null order by e.seq desc limit 1)
	where id like 'departure:%' and subject like 'Departure: %' and exists (
		select 1 from events e where e.type = 'person_departed' and e.session_id = substr(threads.subject, 12)
			and json_extract(e.data, '$.name') is not null);`,

	`create table message_reactions (
		message_id text not null,
		person text not null,
		emoji text not null,
		at integer not null,
		primary key (message_id, person, emoji)
	) strict;`,

	`create table activity_items (
		id text primary key,
		source text not null,
		kind text not null,
		conversation text not null,
		title text not null,
		actor text,
		url text,
		excerpt text,
		at integer not null,
		observed_at integer not null,
		direct integer not null,
		delivered_at integer,
		triage text
	) strict;
	create index activity_items_at on activity_items (at);
	create table activity_cursors (source text primary key, cursor text not null, polled_at integer not null, error text) strict;`,

	`create table activity_rules (
		id text primary key,
		match text not null,
		effect text not null,
		person text,
		note text not null,
		by text not null,
		created_at integer not null
	) strict;
	alter table activity_items add column rule text;`,

	`create table notes (
		id text primary key,
		title text not null,
		body text not null,
		topics text not null,
		refs text not null,
		by text not null,
		created_at integer not null,
		updated_at integer not null
	) strict;`,

	`create table canvases (
		id text primary key,
		title text not null,
		body text not null,
		by text not null,
		created_at integer not null,
		updated_at integer not null,
		updated_by text not null,
		version integer not null,
		pinned integer not null
	) strict;
	create index canvases_updated on canvases (updated_at);`,

	`create index messages_by_time on messages (session_id, part, at);`,

	`create table focus_spans (
		person text not null,
		task_id text not null,
		started_at integer not null,
		ended_at integer,
		reconstructed integer not null default 0
	) strict;
	create index focus_spans_by_task on focus_spans (task_id);
	create index focus_spans_by_person on focus_spans (person, started_at);
	create trigger focus_span_open after insert on work_focus begin
		insert into focus_spans (person, task_id, started_at)
		values (new.person, new.task_id, cast(unixepoch('subsec') * 1000 as integer));
	end;
	create trigger focus_span_move after update of task_id on work_focus when old.task_id != new.task_id begin
		update focus_spans set ended_at = cast(unixepoch('subsec') * 1000 as integer)
		where person = old.person and ended_at is null;
		insert into focus_spans (person, task_id, started_at)
		values (new.person, new.task_id, cast(unixepoch('subsec') * 1000 as integer));
	end;
	create trigger focus_span_close after delete on work_focus begin
		update focus_spans set ended_at = cast(unixepoch('subsec') * 1000 as integer)
		where person = old.person and ended_at is null;
	end;`,

	`alter table review_attempts add column reviewer text not null default '{"kind":"temp"}';
	alter table review_attempts add column fork_file text;`,

	`alter table review_attempts add column fork_offset integer;`,

	`alter table sessions add column incorporated integer not null default 0;
	update sessions set incorporated = 1;
	alter table sessions add column closing_generation integer;
	alter table incarnations add column interactive integer not null default 0;`,
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
