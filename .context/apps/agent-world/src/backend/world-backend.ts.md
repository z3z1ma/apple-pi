## file

The backend imports only Node, Electron-free npm modules, and other `apps/agent-world/src/backend/` files; nothing from `components/` or `@earendil-works/pi-coding-agent`. What it needs about sessions it reads from the session-state database, and a column a newer migration adds is selected only when `pragma_table_info` lists it (`OPTIONAL_COLUMNS`: the organization's `role_title`, `manages`, `soul`, `self`, `retired_at`, `retired_reason`). Who manages is the `manages` fact the bridge reports (stored as 0/1), or having anyone report to it; the role's name is never interpreted here, and the catalog is read from its files (`roles.ts`) only for the hire form.
Why: the Electron main build (`apps/agent-world/electron.vite.config.ts`) bundles everything it imports except Electron and `node:`, so a `components/` import drags the package's extension code into the committed `dist/`; and the running runtime keeps old code and an unmigrated database until it restarts, so a selected column may not exist yet.
Coupled: apps/agent-world/electron.vite.config.ts, components/session-state/src/schema.ts
Verify: apps/agent-world/tests/backend.test.ts

## symbol:openWorldBackend

The database is opened writable with `pragma query_only = 1`, not `readOnly`, and only once the file exists.
Why: a strictly read-only connection reads no rows from a WAL database whose -shm file is gone (as after the runtime stops), and opening a missing path writable would create an empty database the runtime did not make.
Coupled: components/tmux-sessions/sidebar/model.py
Verify: apps/agent-world/tests/backend.test.ts

"Connected" is an open connection to the runtime socket plus a readable database; it sends only `set_preference` commands that remember wings and the chosen avatar look.
Why: the runtime destroys every connection on stop and the OS closes it on any exit, so its close is the prompt signal that the runtime is gone; database rows alone stay "alive" after the runtime dies. Later command and streaming traffic can share this connection.
Verify: apps/agent-world/tests/backend.test.ts

Wings outlive their workers: the `agent-world` preference (`{wings: {coordinatorId: repository[]}, avatar: look}`) is read from the `preferences` table on each pass and written back over the socket with `set_preference` (other keys in the value preserved) only when wings seen this run add to it or a look chosen this run differs from the stored one. Both go in one value through `remember`, so a wings write never overwrites a look being stored, or the reverse; `setAvatarLook` resolves when a later read finds the look stored, on a failed receipt, or after `STORE_TIMEOUT_MS`.
Why: the agent world must not write the runtime's database (query_only above); the runtime owns writes and answers with a receipt. A failed receipt is retried after a pause, and the run's memory resets on reconnect so a restart reads the stored order.
Coupled: apps/agent-world/src/backend/projection.ts, components/session-state/src/runtime.ts
Verify: apps/agent-world/tests/backend.test.ts

The world is reread when `max(seq)` of `events` changes, and also every `TASK_REREAD_POLLS` polls without one.
Why: every fact a character shows changes with an event, except a ledger task's title and status, which live in its `task.md` and can be edited with no runtime event.
Verify: apps/agent-world/tests/backend.test.ts

A reread reads only the session rows that newer events name plus the ones awake at the last read (`CHANGED_SESSIONS`), keeping the other rows from before; every row is read again on the first read, after a reconnect or a new database (its sequence went back), and every `FULL_REREAD_POLLS` polls. Sleepers' task files are checked only on the task rereads, and `dormantAgents` keeps each sleeper made from an unchanged row object, returning the previous array itself when nothing changed, so `publish` compares the inn (and the mail, kept the same way) by reference.
Why: measured in ticket 30 with 3,000 and 10,000 stopped root sessions, reading and comparing every row on each event was most of the main process's time while one agent worked (123 and 364 ms a second before, 30 and 64 after). It relies on every change to a session's row coming with an event naming that session, as the runtime's facts, run states, incarnations, and tasks do; the full reread bounds the cost of any that does not.
Coupled: apps/agent-world/src/backend/inn.ts, apps/agent-world/src/backend/facts.ts, components/session-state/src/runtime.ts
Verify: apps/agent-world/tests/backend.test.ts, apps/agent-world/tests/inn.test.ts

The feed keeps its own sequence cursor, apart from the world's: the first read starts from a short backlog (the last `FEED_BACKLOG` lines within the last `FEED_BACKLOG_EVENTS` events), and a database whose sequence is behind the cursor (a new database) starts again from a backlog.
Why: the world's read skips when nothing changed, but every line must reach the chatbox once and in order, within a second.
Coupled: apps/agent-world/src/backend/feed.ts
Verify: apps/agent-world/tests/backend.test.ts

## symbol:leaveOutUnchanged

Leaves the inn and the mail out of an update while they are the same array (by reference) as in the last update it made, naming them in `unchanged`; `web/world-store.ts` keeps its own and, when an update names a part it never had (a reloaded window), fills it from the whole `snapshot()` it asked for at start. It relies on `publish` keeping those arrays the same while unchanged; a new but equal array is only sent whole, never wrongly left out. One instance per receiver, advanced only when the update is actually sent.
Why: ticket 31 measured 17.5 MB/s of IPC at 10,000 sleepers while one agent worked, nearly all of it the inn; updates are now about 17 KB.
Coupled: apps/agent-world/src/electron/main.ts, apps/agent-world/web/world-store.ts, apps/agent-world/src/world.ts
Verify: apps/agent-world/tests/backend.test.ts, apps/agent-world/tests/world-inn.test.ts
