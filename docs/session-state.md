# Session state

Apple-pi keeps one shared account of your Pi sessions in a SQLite database. Every root Pi session reports to it, and every view reads from it. The design and the remaining steps are in the ledger task `.ledger/202610172354-session-state-model/` (`spec.md` and `tickets/`); this page describes what exists now.

## Parts

- **Bridge** (`components/session-state/src/bridge.ts`, loaded by `extensions/session-state.ts`): an extension in every root session and, by path, in every interactive child session (subagent); the internal `/btw` session does not load it. It reports the session's identity, its process, and its run state, sends a heartbeat every second, and reports a clean shutdown.
- **Runtime** (`components/session-state/src/runtime.ts`): one daemon per Mac and the only writer to the database. The first bridge that finds no runtime starts it with `node`, detached, and it keeps running after sessions end. One instance is guarded by an exclusive SQLite lock it holds for its whole life; the operating system releases it however the runtime exits, so there is no stale lock to clean up. If the runtime cannot start, the session shows one warning naming the runtime log.
- **Clients** (`client.ts`): `sendCommand` sends one command over the socket and starts the runtime when none answers; `mailbox_send`, `scripts/pi-send.mjs`, and the close notice use it. Mail delivery and its tool live in `mail.ts`.
- **Database**: SQLite in WAL mode, created and upgraded by forward migrations (`schema.ts`; the schema version is SQLite's `user_version`).

Everything lives under `~/.pi/agent/state/` (or `$PI_CODING_AGENT_DIR/state/`, where a leading `~` means the home directory, as in Pi): `apple-pi.db`, the socket `apple-pi.sock` (mode `0600`), the lock `apple-pi-runtime.lock`, the running runtime's pid in `apple-pi-runtime.pid`, and its output in `apple-pi-runtime.log`.

## What it records

- `sessions`: one row per Pi session id, with its kind (`root`, or `child` for a subagent, with `spawned_by` naming the session that started it, recorded as a `spawned_by` event; a child runs in its parent's process, so its incarnation has the parent's pid and no pane of its own; a stopped subagent stays live and resumable in its parent, so it shows idle with its abort, and its incarnation ends when the session is disposed), session file, directory, name, current run state (`idle`, `thinking`, `writing_reply`, `running_tool`, `compacting`), and current generation, plus everything else its bridge observes:
  - the top-level tool running now (`current_tool`, its id, its main argument such as the command or path, and since when). Pi can run several tools at once: each start and end is an event with its duration, and while any still runs, the session shows the most recently started one;
  - an open `prompt` (JSON): a questionnaire with its `id` and questions while `ask_user_question` runs, or another dialog's kind and title;
  - the `queue` (JSON): steers and follow-ups typed during a run and not yet delivered (Pi delivers steers first), and `pending`, Pi's own flag that something waits, which also covers messages other extensions queued;
  - `last_error` (a failed reply's message) and `last_abort_at`;
  - `model`, `thinking_level`, `context_tokens`, `context_window`, and `cost` so far;
  - relations: `reports_to` (the coordinator session from `--reports-to`), `parent_session_file` and `parent_session_id` (the session it was forked or cloned from), and `previous_session` with `previous_session_id` (the session that ran before it in the same process and pane, and whether it gave way to a new session, a resume, or a fork); the ids are filled in once that session is known;
  - `git` (JSON): repository, worktree, and branch of its directory, read when it starts, after each shell command, and when a run settles; null when git says it is not a repository; a failed read (no git, a timeout) keeps the last known value;
  - `current_task` (JSON): the ledger task it touched last; it survives a reload or reopen, since a new bridge reports a task only once it sees a touch;
  - `config` (JSON): name, the names of the options on Pi's command line (not their values, which could include a prompt), active tools, extensions, loaded skills, and MCP servers. Extensions are the files that registered tools or extension commands; Pi lists no extensions, so one that registers only hooks does not appear.

  Only the session's current generation changes these. Streamed text and tool progress update nothing, so they write no events.
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
| `close` | | Quits the session's Pi process |

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

A mail is delivered when the session's transcript records it, as a `custom_message` entry with the mail in `details`; until then a crash or a closed process means it is sent again on the next open, and its id identifies the repeat. A mail recorded on a branch that `/tree` left is not delivered again. When Pi itself starts, waiting mail rides the first run instead of starting one, because the command may carry its own prompt (`pi -p "..."`, `pi --session-id w-7f3a "brief"`) and Pi rejects a prompt while a turn is running. If you press Escape while mail is queued, Pi discards the queue; the mail comes again on the session's next open.

For a stable address, start a session with a fixed id: `pi --session-id coordinator` reopens the same session every time. `/fork` and `/clone` create a new session id; `/tree` keeps it. Session ids are shared across projects, so give a named id such as `coordinator` to one project only.

A session started with `--reports-to <id>` mails that session when it closes, except on reload: `Session "<name>" closed (<reason>) while <idle|busy|waiting>. Directory: <cwd>`.

## Coordinator tools

A root session started with `pi --coordinator` gets three more tools, which send the commands above with that session's pane and id: `start_session` (`cwd`, `name`, optional `prompt` such as `@brief.md`, optional `session_id`) starts a peer session that reports to it, `reopen_session` reopens a stopped one by id, and `close_session` closes a running one. Every root session registers them, so it can read the flag, but only a coordinator keeps them active. The [coordinator skill](../skills/coordinator/SKILL.md) uses them.

## Reading a transcript entry

Any client can ask the runtime for one entry of a session's transcript by sending `{"type": "read_entry", "requestId": ..., "sessionId": ..., "entryId": ...}` on the socket. The runtime reads the entry from the session's JSONL file and answers on the same connection with `{"type": "entry", "requestId": ..., "entry": {...}}`, or with `"error"`: `unknown session`, `session has no transcript file`, `entry not found`, or why the file could not be read.

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
