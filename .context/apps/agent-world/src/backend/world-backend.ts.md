## symbol:openWorldBackend

The database is opened writable with `pragma query_only = 1`, not `readOnly`, and only once the file exists.
Why: a strictly read-only connection reads no rows from a WAL database whose -shm file is gone (as after the runtime stops), and opening a missing path writable would create an empty database the runtime did not make.
Coupled: components/tmux-sessions/sidebar/model.py
Verify: apps/agent-world/tests/backend.test.ts

"Connected" is an open connection to the runtime socket plus a readable database; it sends only `set_preference` commands that remember wings.
Why: the runtime destroys every connection on stop and the OS closes it on any exit, so its close is the prompt signal that the runtime is gone; database rows alone stay "alive" after the runtime dies. Later command and streaming traffic can share this connection.
Verify: apps/agent-world/tests/backend.test.ts

Wings outlive their workers: the `agent-world` preference (`{wings: {coordinatorId: repository[]}}`) is read from the `preferences` table on each pass and written back over the socket with `set_preference` (other keys in the value preserved) only when wings seen this run add to it.
Why: the agent world must not write the runtime's database (query_only above); the runtime owns writes and answers with a receipt. A failed receipt is retried after a pause, and the run's memory resets on reconnect so a restart reads the stored order.
Coupled: apps/agent-world/src/backend/projection.ts, components/session-state/src/runtime.ts
Verify: apps/agent-world/tests/backend.test.ts
