## symbol:openWorldBackend

The database is opened writable with `pragma query_only = 1`, not `readOnly`, and only once the file exists.
Why: a strictly read-only connection reads no rows from a WAL database whose -shm file is gone (as after the runtime stops), and opening a missing path writable would create an empty database the runtime did not make.
Coupled: components/tmux-sessions/sidebar/model.py
Verify: apps/agent-world/tests/backend.test.ts

"Connected" is an open connection to the runtime socket plus a readable database; the connection sends nothing.
Why: the runtime destroys every connection on stop and the OS closes it on any exit, so its close is the prompt signal that the runtime is gone; database rows alone stay "alive" after the runtime dies. Later command and streaming traffic can share this connection.
Verify: apps/agent-world/tests/backend.test.ts
