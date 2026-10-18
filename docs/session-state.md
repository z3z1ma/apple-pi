# Session state

Apple-pi keeps one shared account of your Pi sessions in a SQLite database. Every root Pi session reports to it, and every view reads from it. The design and the remaining steps are in the ledger task `.ledger/202610172354-session-state-model/` (`spec.md` and `tickets/`); this page describes what exists now.

## Parts

- **Bridge** (`components/session-state/src/bridge.ts`, loaded by `extensions/session-state.ts`): an extension in every root session. It reports the session's identity, its process, and its run state, sends a heartbeat every second, and reports a clean shutdown.
- **Runtime** (`components/session-state/src/runtime.ts`): one daemon per Mac and the only writer to the database. The first bridge that finds no runtime starts it with `node`, detached, and it keeps running after sessions end. One instance is guarded by an exclusive SQLite lock it holds for its whole life; the operating system releases it however the runtime exits, so there is no stale lock to clean up. If the runtime cannot start, the session shows one warning naming the runtime log.
- **Database**: SQLite in WAL mode, created and upgraded by forward migrations (`schema.ts`; the schema version is SQLite's `user_version`).

Everything lives under `~/.pi/agent/state/` (or `$PI_CODING_AGENT_DIR/state/`, where a leading `~` means the home directory, as in Pi): `apple-pi.db`, the socket `apple-pi.sock` (mode `0600`), the lock `apple-pi-runtime.lock`, the running runtime's pid in `apple-pi-runtime.pid`, and its output in `apple-pi-runtime.log`.

## What it records

- `sessions`: one row per Pi session id, with its kind, session file, directory, name, current run state (`idle`, `thinking`, `writing_reply`, `running_tool`, `compacting`), and current generation.
- `incarnations`: one row per process lifetime of a session (generation 1, 2, ... on each reopen), with pid, process start time, process state, start and end, and why it ended.
- `events`: an append-only history of run-state changes, process-state changes, incarnations starting and ending, and failed process checks. Every row names its source (`bridge` or `runtime`) and time.

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
