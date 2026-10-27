## symbol:listPanes

The deadline is an abort signal, not execFile's `timeout` option.
Why: a tmux client killed on timeout by a server that stopped answering exits 0 with no output, which read as a server with no panes and deleted its whole topology.
Verify: components/session-state/tests/tmux.test.ts, components/session-state/tests/program-peers.test.ts

Fields are separated by a tab; `\u001f` and similar control characters do not work.
Why: tmux escapes control characters inside format output (`\037`), but prints a tab written in the format as is and escapes tabs inside values, so a tab cannot occur within a field.

Only tmux's own "no server running" or "error connecting ... (No such file or directory | Connection refused)" answer means absent (matched case-insensitively: tmux writes "Error connecting"); every other failure throws.
Why: a permission error or a missing `tmux` binary proves nothing about the server; treating it as absence wrote false removals.

The initial command is used to recover a program window when the daemon died before recording its pane id or receiving hello. A window name can already have changed; the initial command still carries the session id. This field stays transient rather than becoming a second process identity in the database.
Coupled: components/session-state/src/runtime.ts

## symbol:killPane

The expected PID and dead state are checked together in a non-yielding tmux server command. A prior list result is only an observation; a live or respawned pane remains untouched even if it reuses the same pane id.
Why: an awaited shell condition creates a check/kill gap in which respawn can replace the process. This guard removes an old pane, not a newly live process, and complements the runtime's separate writer/process proof.
Coupled: components/session-state/src/runtime.ts
Verify: components/session-state/tests/tmux.test.ts

## symbol:canonicalSocket

Socket paths are resolved with `realpath` everywhere they become keys: discovery and the path a bridge reports from `TMUX`.
Why: on macOS `/tmp` and `/var` are links into `/private`, and tmux reports the resolved path, so one server otherwise appeared under two keys.
Coupled: components/session-state/src/runtime.ts
Verify: components/session-state/tests/tmux.test.ts
