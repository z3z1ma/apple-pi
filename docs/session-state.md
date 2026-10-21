# Session state

Apple-pi keeps one shared account of your Pi sessions in a SQLite database. Every root Pi session reports to it, and every view reads from it. The design and the remaining steps are in the ledger task `.ledger/202610172354-session-state-model/` (`spec.md` and `tickets/`); this page describes what exists now.

## Parts

- **Bridge** (`components/session-state/src/bridge.ts`, loaded by `extensions/session-state.ts`): an extension in every root session and, by path, in every interactive child session (subagent); the internal `/btw` session does not load it. It reports the session's identity, its process, and its run state, sends a heartbeat every second, and reports a clean shutdown.
- **Runtime** (`components/session-state/src/runtime.ts`): one daemon per Mac and the only writer to the database. The first bridge that finds no runtime starts it with `node`, detached, and it keeps running after sessions end. One instance is guarded by an exclusive SQLite lock it holds for its whole life; the operating system releases it however the runtime exits, so there is no stale lock to clean up. If the runtime cannot start, the session shows one warning naming the runtime log.
- **Clients** (`client.ts`): `sendCommand` sends one command over the socket and starts the runtime when none answers; `mailbox_send`, `scripts/pi-send.mjs`, and the manager tools use it; the close notice goes over the bridge's own connection. Mail delivery and its tool live in `mail.ts`.
- **Database**: SQLite in WAL mode, created and upgraded by forward migrations (`schema.ts`; the schema version is SQLite's `user_version`).

Everything lives under `~/.pi/agent/state/` (or `$PI_CODING_AGENT_DIR/state/`, where a leading `~` means the home directory, as in Pi): `apple-pi.db`, the socket `apple-pi.sock` (mode `0600`), the lock `apple-pi-runtime.lock`, the running runtime's pid in `apple-pi-runtime.pid`, and its output in `apple-pi-runtime.log`.

## What it records

- `sessions`: one row per Pi session id, with its kind (`root`, or `child` for a subagent, with `spawned_by` naming the session that started it, recorded as a `spawned_by` event; a child runs in its parent's process, so its incarnation has the parent's pid and no pane of its own; its incarnation ends when `stop_subagent` releases it or its parent session ends), session file, directory, name, current run state (`idle`, `thinking`, `writing_reply`, `running_tool`, `compacting`), and current generation, plus everything else its bridge observes:
  - the top-level tool running now (`current_tool`, its id, its main argument such as the command or path, and since when). Pi can run several tools at once: each start and end is an event with its duration, and while any still runs, the session shows the most recently started one;
  - an open `prompt` (JSON): a questionnaire with its `id` and questions while `ask_user_question` runs, or another dialog's kind and title;
  - the `queue` (JSON): steers and follow-ups typed during a run and not yet delivered (Pi delivers steers first), and `pending`, Pi's own flag that something waits, which also covers messages other extensions queued;
  - `last_error` (a failed reply's message) and `last_abort_at`;
  - `model`, `thinking_level`, `context_tokens`, `context_window`, and `cost` so far;
  - relations: `reports_to` (the manager session from `--reports-to`), `role` (the role catalog name the session took at its first start, see [Roles](#roles)), `soul` (one line of the soul drawn with the role), `self` (the person's self, reported at every start and after each `update_self`), `parent_session_file` and `parent_session_id` (the session it was forked or cloned from), and `previous_session` with `previous_session_id` (the session that ran before it in the same process and pane, and whether it gave way to a new session, a resume, or a fork); the ids are filled in once that session is known;
  - `git` (JSON): repository, worktree, and branch of its directory, read when it starts, after each shell command, and when a run settles; null when git says it is not a repository; a failed read (no git, a timeout) keeps the last known value;
  - `current_task` (JSON): the ledger task it touched last; it survives a reload or reopen, since a new bridge reports a task only once it sees a touch;
  - `intent`: one short sentence of what the session says it works on now, written by the session-title extension's `quick` model after each settled user turn (see [Session titles](context.md#session-titles)); each change is an `intent_changed` event. Like `current_task`, it survives a reload or reopen, since a new bridge reports it only once the next turn writes one. Views show the ledger task when there is one and the intent otherwise. A runtime started before the migration that adds this column runs old code and ignores the fact until it restarts; the views read the column only when the database has it;
  - `config` (JSON): name, the names of the options on Pi's command line (not their values, which could include a prompt), active tools, extensions, loaded skills, and MCP servers. Extensions are the files that registered tools or extension commands; Pi lists no extensions, so one that registers only hooks does not appear.

  Only the session's current generation changes these. Streamed text and tool progress update nothing, so they write no events (subscribed clients see streamed text live; see [Live replies](#live-replies)).
- `incarnations`: one row per process lifetime of a session (generation 1, 2, ... on each reopen), with pid, process start time, process state, start and end, and why it ended. An incarnation running in tmux is bound to its pane: the server socket and pane id the bridge reads from `TMUX` and `TMUX_PANE`, and the pane's tty once the runtime has seen the pane (recorded with `tmux` as its source).
- `tmux_servers`, `tmux_sessions`, `tmux_windows`, `tmux_window_links`, `tmux_panes`: every live tmux server (keyed by its resolved socket path, so `/tmp` and `/private/tmp` are one server) and its sessions, windows, and panes, including panes that run no Pi. A window can be linked into several sessions, so each link (session, window, index in that session) is its own row. tmux ids such as `%3` are only unique within a server, so every row also carries the socket. A pane row holds its window, tty, first process, current command and path, and whether it is active or dead.
- `messages`: an index of each session's completed conversation, one row per message (user, assistant, tool result, or an extension's custom message such as delivered mail) and one per tool call inside an assistant message (`part` is the tool call id). A row holds the transcript entry id, the entry's own time (`at`), when the runtime first indexed it (`observed_at`), role, tool, size, and a short preview; the text itself stays in Pi's session JSONL. The bridge looks for new transcript entries after each turn and once a second, so messages appended while the session is idle are indexed too.
- `session_tasks`: every time a session touches a ledger task (creates it, changes its status, or changes its files), with the bundle, task id, how (`ledger_add`, `ledger_status`, `edit`), and when. The ledger extension announces each touch on the `ledger:session-linked` event channel (`components/shared/src/ledger-events.ts`); unlike `history.json`, which records a session once per task, every touch is kept, so a session's work over time is visible. A session without a transcript file (an in-memory subagent) is announced too; only `history.json` stays limited to sessions with a transcript.
- `events`: an append-only history of run-state changes, tools starting and ending (with duration), prompts opening and closing, every other change to a session's facts (`<column>_changed`), each newly indexed message (`message`), process-state changes, incarnations starting and ending, failed process checks, every tmux server, session, window, window link, and pane added, changed, or removed, and failed tmux reads. Every row names its source (`bridge`, `runtime`, or `tmux`) and time.

## tmux

Once a second the runtime runs one `tmux list-panes -a` against every server socket in tmux's own socket directory (`$TMUX_TMPDIR`, or `/tmp`, then `tmux-<uid>`) and every socket a live session reported, and brings the tmux tables up to date in one transaction. A server outside that directory with no Pi session in it is not seen; finding it would mean inspecting every process's open sockets.

Each read has one second to answer. Only tmux's own "no server running" or "error connecting ... (No such file or directory | Connection refused)" means a server is gone and removes its rows. Any other failure (a timeout, a server that stopped answering, no permission, no tmux) proves nothing: the server keeps its rows, one `tmux_server_read_failed` event is recorded and logged, and the other servers are read as usual.

The pane's tty comes from tmux, not from the bridge, so the runtime fills it in from the topology and records it with source `tmux` and its own event.

## Commands

Any client can ask a session to do something by sending `{"type": "command", "commandId": ..., "sessionId": ..., "command": {...}}` on the socket; add `"generation"` to bind it to one incarnation, so it can never reach a later one. Commands:

| `kind` | Fields | Effect |
| --- | --- | --- |
| `talk` | `text` | A new user turn; fails with `busy` while a run is active |
| `steer` | `text` | Redirects the active run at its next boundary (starts a turn when idle) |
| `follow_up` | `text` | Queued until the active run ends |
| `abort` | | Stops the active run; applied once the run has stopped |
| `rename` | `name` | Renames the session |
| `set_model` | `provider`, `id` | Switches model; fails for an unknown or unavailable model |
| `set_thinking` | `level` | Sets the thinking level |
| `answer` | `questionnaire`, `replies` | Answers the open questionnaire with that prompt `id`: one reply per question, in order, either `{"selected": [labels]}` or `{"custom": text}`. The dialog in the terminal closes, and the tool returns what the terminal would for the same choices. Fails when the terminal answered first or the replies do not fit; other dialogs are answered only in the terminal |
| `mail` | `from`, `body`, `sentAt` | Mails the session; see [Mail](#mail). Waits while the session is not running |
| `start` | `tmux` (`socket`, `pane`), `cwd`, `name`, `reportsTo`, `prompt` | Runs by the runtime itself: opens a tmux window after that pane's window running `pi --session-id <id> [--name] [--reports-to] [prompt]`, for a new id or a stopped session (whose `cwd` and `name` are the defaults). Fails when the session runs; `delivered` once the window opened, `applied` when the session's bridge connects, `failed` when the window closes first |
| `close` | | Stops a running turn and quits the session's Pi process |
| `mark_seen` | | The operator saw the session (applied by the runtime); see [Attention](#attention) |
| `set_preference` | `key`, `value` (JSON) | Stores a UI preference in the `preferences` table (applied by the runtime; `sessionId` only names the sender, such as `notch`); the notch keeps its choices under `notch` |

The runtime stores each command in `commands` and answers the sender with one `{"type": "receipt", "commandId": ..., "stage": ..., "reason"?: ...}` line per stage: `accepted` (stored), `delivered` (the session's bridge has it), `applied` (Pi took it), or `failed` with a reason. Each stage is also an event (`command_accepted`, ...). No receipt says the work is done; its effects appear as ordinary observed facts and events. A command for a session with no live incarnation, or bound to one that is no longer current, fails at once with `not running`. Sending the same `commandId` again applies nothing and answers with the stage the first one reached. A command handed to a bridge is bound to that incarnation, and only it can report on the command; if the bridge disconnects first, the command fails, since nobody can say whether it was applied (mail is sent again instead). `talk`, `steer`, and `follow_up` fail with `no model selected` when the session has no model. Anyone who can open the socket, which is only your user, can send commands; confirmations belong to the view that sends them.

## Mail

Any session can mail another by its session id, and the receiver gets the message as a `<mailbox-message>` steer: at the next safe boundary during a run, as a new turn while idle, or with the first run after it next opens. Agents in root sessions call `mailbox_send`:

```json
{
  "session_id": "coordinator",
  "message": "Worker w-7f3a is blocked on a review."
}
```

`list_peer_sessions` lists the other live top-level sessions (peer sessions) with their id, name, directory, status (`busy`, `idle`, or `waiting`), the session each reports to, and its current ledger task; subagents are not peers, and the tool descriptions say so. `from` is the sender's session id, so the receiver can answer with `mailbox_send` to that id. `mailbox_send` returns once the runtime has the mail and says when it waits. Anything outside Pi uses the packaged script; its path is in the `mailbox_send` tool guidance:

```bash
node components/session-state/scripts/pi-send.mjs coordinator --from launchd "Tick."
echo "Nightly sweep finished." | node components/session-state/scripts/pi-send.mjs coordinator
```

Both send a `mail` command over the socket, starting the runtime when none runs, and both say when the session is not running (or no session with that id has run yet) and the mail waits. Mail is the one command that waits instead of failing: the runtime sends every mail not yet delivered to each new bridge of its session. The `mail` view lists each mail with `sender`, `receiver`, `body`, `sent_at`, and `delivered_at`.

A mail is delivered when the session's transcript records it on disk, as a `custom_message` entry with the mail in `details` (Pi writes a new session's file once it holds a user or assistant message); until then a crash or a closed process means it is sent again on the next open, and its id identifies the repeat. A mail recorded on a branch that `/tree` left is not delivered again. When Pi itself starts, mail that waited for it rides the first run instead of starting one (mail sent after it started starts a turn as usual), because the command may carry its own prompt (`pi -p "..."`, `pi --session-id w-7f3a "brief"`) and Pi rejects a prompt while a turn is running. If you press Escape while mail is queued, Pi discards the queue; the mail comes again on the session's next open.

For a stable address, start a session with a fixed id: `pi --session-id coordinator` reopens the same session every time. `/fork` and `/clone` create a new session id; `/tree` keeps it. Session ids are shared across projects, so give a named id such as `coordinator` to one project only.

Mail bound to one incarnation (`generation`) never waits for a later one. A session started with `--reports-to <id>` mails that session when it closes, except on reload, through its own connection to the runtime (dropped, with a line on stderr, when the runtime is unreachable, so shutdown goes on): `Session "<name>" closed (<reason>) while <idle|busy|waiting>. Directory: <cwd>`.

## Attention

The runtime keeps, per session, `seen_at` (when the operator last saw it), `settled_at` (when its run last settled), and `needs_you_since`: set when a run settles or a prompt opens, cleared when the operator sees it and no prompt is open, or when the prompt closes with no unseen settle. A run that settles counts (a compaction outside a run does not). A session is seen when a tmux client shows its pane (the runtime reads `list-clients` with its once-a-second tmux poll; no hook) after it settled and when a client sends `mark_seen`; each is a `seen` event. For each tmux server the runtime writes the status-line summary of the live top-level sessions in its panes to `@pi_agents` (asking you, done and unseen, working, idle) and the pane that has needed you longest to `@pi_jump_target`, only when they change, and redraws the status line of every client.

## Roles

A root session started with `pi --role <name>` takes that role for life. A role is a Markdown file in the role catalog (`components/organization/src/roles.ts`): the package's `roles/` directory, then `~/.pi/agent/roles/`, then `<cwd>/.pi/roles/`, a later file replacing an earlier one of the same name. Its front matter gives `title`, `models` (`provider/id` in order of preference), `thinking`, `writes` (whether the session keeps the built-in `edit` and `write` tools), and `manages` (whether it gets the manager tools below); its body is the role's obligation, which becomes the `<role>` section of the system prompt. At every start the session switches to the first listed model the registry knows, at the role's thinking level, and warns once when none is available; with `writes: false` it drops `edit` and `write` before each run (Pi restores the tool set from the transcript, so posture is re-applied). The role is recorded as an `organization-role` custom entry in the session's own transcript at its first start, so a reopen or resume re-applies it without the flag, and a stored role wins over a later flag. The bridge reports it as the `role` fact. The first start with a role also draws the person's soul from the package's lists (`soul.ts`: a stance, an evidence taste, a risk appetite, a length, an outlook on estimates, and one habit), with no model call, stores it in the same transcript entry, renders it as a paragraph under the role body, and reports one line of it as the `soul` fact, which the directory shows. Two people in one role differ by soul; a session without a role has none. A role file with a missing or malformed field is reported by path and skipped, and an unknown role name warns and leaves the session unroled.

## The organization

Root sessions form organizations: a session started with `--reports-to <id>` has that session as its manager, a session with no manager is a root, and an organization is a root with every session whose chain of managers reaches it, at any depth, awake or asleep. The organization is read from the `reports_to` column (`components/organization/src/directory.ts`); nothing else stores it. `list_peer_sessions` is the directory of the caller's organization: every other member with its id, name, role, manager (`reportsTo`), status (`busy`, `idle`, `waiting`, or `asleep`), directory, current ledger task, the ledger tasks it has worked on (`session_tasks`, newest first), and when it first started. Sessions in other organizations are not listed; mail by id reaches any session on the machine. `/pi-sessions` still lists every live session for the operator.

Every root session's system prompt has an `<org>` section (`charters.ts`): who the session is (name and role title), its id as its mail address, its manager and root, how the directory and mail work, and the tree's norms (work, reports, and escalation follow the tree; a manager is never a relay; say what you verified and what you believe). A hired session is told to ask its manager for people it lacks and when to escalate; a root is told it holds the manager tools. A session whose role manages also gets the `<manager>` charter: memory on disk, hiring colliding perspectives from the catalog, giving independent thinkers the problem before the preferred answer, routing by affinity, delegating whole outcomes, naming disagreements, escalating by uncertainty times consequence, sizing the team like hiring, hiring a manager under itself when fan-in would make it the bottleneck, reconciling against the directory, and sweeping. Its principal is the operator for a root and its manager for a hired manager.

## Manager tools

A root session, and a session whose role manages, gets four more tools: `start_peer_session` (`cwd`, optional `role`, optional `prompt` such as `@brief.md`, optional `session_id`) hires a peer session that reports to it, takes the given role at its first start, and receives a unique two-part human name from the session-title extension; `reopen_peer_session` reopens a stopped one by id, with the role its transcript records; `close_peer_session` closes a running one; and `rename_peer_session` (`session_id`, `name`) renames a running one through its bridge without changing its id or history. Start and reopen send the manager's pane and id. A hire into a role the catalog lacks fails before any window opens. Every root session registers the four tools, but only a root (the operator's seat) or a managing role keeps them active. Root-session lifecycle hooks restore `list_peer_sessions` for every root and the four manager tools for those sessions, including when Pi resumes an older transcript whose saved tool set lacks them.

## Reading a transcript entry

Any client can ask the runtime for one entry of a session's transcript by sending `{"type": "read_entry", "requestId": ..., "sessionId": ..., "entryId": ...}` on the socket. The runtime reads the entry from the session's JSONL file and answers on the same connection with `{"type": "entry", "requestId": ..., "entry": {...}}`, or with `"error"`: `unknown session`, `session has no transcript file`, `entry not found`, or why the file could not be read.

## Reading history a page at a time

To scroll a conversation from the newest message up, send `{"type": "read_entries", "requestId": ..., "sessionId": ..., "limit"?: n, "before"?: entryId}`. The page is keyed by the session's `messages` index: its message entries (`part` `""`) ordered by `at`, then by when they were indexed. Without `before` the runtime returns the newest `limit` entries (50 by default); with it, the `limit` entries just before that entry. It reads the JSONL once per page, whatever the page holds, and answers with `{"type": "entries", "requestId": ..., "entries": [...], "before": ...}`: the entries in transcript order, oldest first, and in `before` the cursor for the page before (the first entry's id), or `null` when the page starts at the first indexed entry. Indexed ids the transcript no longer holds are left out and listed in `"missing"`. Errors are the same as for `read_entry`, plus `unknown cursor` when `before` is not an indexed entry of that session. Only indexed entries are paged, so a turn still running is not there yet.

## Live replies

A reply can be shown while the agent writes it. A client subscribes on its own socket connection with `{"type": "subscribe", "sessionIds": [...]}`; the runtime confirms with `{"type": "subscribed", "sessionIds": [...]}` and from then on relays the reply streams of those sessions on that connection. A subagent is a session of its own: subscribe to its id to see its reply. A new `subscribe` replaces the connection's earlier one, and an empty list ends it. Connections that never subscribe (bridges, command senders, readers) receive no stream.

The bridge forwards each piece of assistant reply text from Pi's `message_update` (`text_delta`; thinking and tool-call arguments are not forwarded), and the runtime relays it as:

- `{"type": "reply_delta", "sessionId": ..., "streamId": ..., "seq": n, "delta": text}`: append `delta` to the reply shown for `streamId`. One stream is one assistant message; `seq` counts its deltas from 1.
- `{"type": "reply_end", "sessionId": ..., "streamId": ..., "messageEntryId"?: id}`: the stream is over. Replace the streamed text with the transcript entry `messageEntryId` names (Pi's `turn_end` names it; it is already indexed and readable with `read_entry`). It is absent when Pi recorded no entry, as for a reply that failed or was aborted before it was saved; the session's history then holds what was kept. An end also closes every earlier stream of that session that never got one.

Streamed text is transient: it is never written to `events` or `messages`, is not sent again after a reconnect, and is lost while the runtime is down; the transcript entry is the record. Only the session's current generation is relayed.

No reader can hold up a writer. When the bridge's own socket to the runtime is full, it joins the stream's deltas into one held delta until the socket drains, so Pi's stream never waits. The runtime does the same for each subscriber: when a client's socket is full (Node's default write buffer), the runtime writes it nothing more until it drains, and holds per session only the newest stream's text, joined into one delta, and the last end. A coalesced delta carries the text of several, and its `seq` is the last one's, so `seq` may skip, but a stream's text arrives in order and whole as long as the client drains before that session's next reply starts. A client still behind then loses the older stream's held text and that stream's own end (the newer end closes it), and reads that reply from history. Either way, what the runtime holds for a client is at most one reply's text and one end per subscribed session; it picks no size limit of its own.

## Runtime outage

A session never depends on the runtime. While the runtime is down, a bridge keeps its session's current state and retries the socket, starting a new runtime if none answers. On reconnect it sends that whole state again: identity, run state, facts, the tool running now, and every conversation row (rows already indexed are ignored). Events that happened while nothing listened are not reconstructed. Instead the runtime records one `gap` event for the incarnation, from the last thing its bridge reported to the reconnect. A bridge that started a runtime will start another if that one dies too. A `/reload` is a short gap of the same kind.

## Liveness

An incarnation is `alive` while its bridge is connected and heard within the last five seconds. When the bridge goes quiet or its connection drops, the runtime checks the process itself (pid plus start time, so a reused pid does not count): a running process is `alive_bridge_lost`; a gone process ends the incarnation as `lost`. A check that fails (for example, `ps` cannot run) proves nothing: the incarnation stays `alive_bridge_lost` and a `process_check_failed` event is recorded. A clean shutdown ends it as `exited`. A `/reload` keeps the same incarnation. Reopening a session from a new process starts the next generation; the previous one ends as `superseded` and stays under watch until its process is gone. Only the current generation's bridge changes the session's run state.

## Running from source

The runtime runs this package's TypeScript directly: `node --import register.mjs runtime-main.ts`, using Node's built-in type stripping (on by default from Node 22.18) and a resolve hook that maps `./x.js` imports to `./x.ts`. Node does not strip types inside `node_modules`, so this works for a local checkout and a Pi git package, the two install paths the README documents.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `PI_CODING_AGENT_DIR` | Moves the state directory with the rest of Pi's agent directory. |
| `PI_SESSION_STATE_DISABLED=1` | The bridge does nothing and starts no runtime. The test suites set it, except the session-state suites. |

## Development

`npx vitest run components/session-state` runs the session-state suites: faux Pi sessions with the bridge against a spawned runtime, and a fake bridge on the socket for liveness edges. Each suite uses its own temporary state directory and stops the runtime it started.
