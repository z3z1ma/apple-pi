# Session state

Apple-pi keeps one shared account of your Pi sessions in a SQLite database. Every root Pi session reports to it, and every view reads from it. The design and the remaining steps are in the ledger task `.ledger/202610172354-session-state-model/` (`spec.md` and `tickets/`); this page describes what exists now.

## Parts

- **Bridge** (`components/session-state/src/bridge.ts`, loaded by `extensions/session-state.ts`): an extension in every root session. It reports the session's identity, its process, and its run state, sends a heartbeat every second, and reports a clean shutdown.
- **Runtime** (`components/session-state/src/runtime.ts`): one daemon per Mac and the only writer to the database. The first bridge that finds no runtime starts it with `node`, detached, and it keeps running after sessions end. One instance is guarded by an exclusive SQLite lock it holds for its whole life; the operating system releases it however the runtime exits, so there is no stale lock to clean up. If the runtime cannot start, the session shows one warning naming the runtime log.
- **Database**: SQLite in WAL mode, created and upgraded by forward migrations (`schema.ts`; the schema version is SQLite's `user_version`).

Everything lives under `~/.pi/agent/state/` (or `$PI_CODING_AGENT_DIR/state/`, where a leading `~` means the home directory, as in Pi): `apple-pi.db`, the socket `apple-pi.sock` (mode `0600`), the lock `apple-pi-runtime.lock`, the running runtime's pid in `apple-pi-runtime.pid`, and its output in `apple-pi-runtime.log`.

## What it records

- `sessions`: one row per Pi session id, with its kind, session file, directory, name, current run state (`idle`, `thinking`, `writing_reply`, `running_tool`, `compacting`), and current generation, plus everything else its bridge observes:
  - the top-level tool running now (`current_tool`, its id, its main argument such as the command or path, and since when);
  - an open `prompt` (JSON): a questionnaire with its questions while `ask_user_question` runs, or another dialog's kind and title;
  - the `queue` (JSON) of steers and follow-ups typed during a run and not yet delivered;
  - `last_error` (a failed reply's message) and `last_abort_at`;
  - `model`, `thinking_level`, `context_tokens`, `context_window`, and `cost` so far;
  - `config` (JSON): name, active tools, the extensions that registered tools or commands, loaded skills, and MCP servers.

  Only the session's current generation changes these. Streamed text and tool progress update nothing, so they write no events.
- `incarnations`: one row per process lifetime of a session (generation 1, 2, ... on each reopen), with pid, process start time, process state, start and end, and why it ended. An incarnation running in tmux is bound to its pane: the server socket and pane id the bridge reads from `TMUX` and `TMUX_PANE`, and the pane's tty once the runtime has seen the pane (recorded with `tmux` as its source).
- `tmux_servers`, `tmux_sessions`, `tmux_windows`, `tmux_window_links`, `tmux_panes`: every live tmux server (keyed by its resolved socket path, so `/tmp` and `/private/tmp` are one server) and its sessions, windows, and panes, including panes that run no Pi. A window can be linked into several sessions, so each link (session, window, index in that session) is its own row. tmux ids such as `%3` are only unique within a server, so every row also carries the socket. A pane row holds its window, tty, first process, current command and path, and whether it is active or dead.
- `events`: an append-only history of run-state changes, tools starting and ending (with duration), prompts opening and closing, every other change to a session's facts (`<column>_changed`), process-state changes, incarnations starting and ending, failed process checks, every tmux server, session, window, window link, and pane added, changed, or removed, and failed tmux reads. Every row names its source (`bridge`, `runtime`, or `tmux`) and time.

## tmux

Once a second the runtime runs one `tmux list-panes -a` against every server socket in tmux's own socket directory (`$TMUX_TMPDIR`, or `/tmp`, then `tmux-<uid>`) and every socket a live session reported, and brings the tmux tables up to date in one transaction. A server outside that directory with no Pi session in it is not seen; finding it would mean inspecting every process's open sockets.

Each read has one second to answer. Only tmux's own "no server running" or "error connecting ... (No such file or directory | Connection refused)" means a server is gone and removes its rows. Any other failure (a timeout, a server that stopped answering, no permission, no tmux) proves nothing: the server keeps its rows, one `tmux_server_read_failed` event is recorded and logged, and the other servers are read as usual.

The pane's tty comes from tmux, not from the bridge, so the runtime fills it in from the topology and records it with source `tmux` and its own event.

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
