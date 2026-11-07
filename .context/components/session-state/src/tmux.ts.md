## file

Pane IDs are unique only within a server; a window linked into several sessions yields one pane row per session. `openWindow` resolves the supplied pane to its window before calling `new-window`.
Why: treating pane IDs as global or using a pane as the new-window target misidentifies the server topology or placement.

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

## symbol:renameWindow

Check expected live pane PID, window ID and the whole physical window's pane/PID/dead-state signature together in a non-yielding tmux server condition. A stale poll snapshot must preserve respawned, moved, dead, missing or newly shared windows. Deduplicate linked-window rows before constructing the signature; tmux's P loop enumerates physical panes once. The runtime refreshes logical identity, connection and single-Pi eligibility before each write and cancels obsolete pending requests; this primitive protects physical composition until execution. Check an already-aborted signal before spawning. Killing a client is not undo: a command already queued for the server can still execute after that client exits. The operator accepted that label-only interval, including a new logical co-owner in an unchanged pane, with pending-write cancellation as mitigation.
Why: a client-side check followed by rename can label a replacement process or a pane moved into another window.

Tmux expands formats in rename-window arguments even inside quotes. Encode each hash as tmux's ASCII-character expansion (a:35), then single-quote the command argument and escape embedded single quotes so style-shaped hashes, aliases, dollars, separators and apostrophes remain data. Blanket hash doubling grows #[...] sequences; a literal modifier ending in a bare hash interferes with the closing brace. Real-server tests assert the intended label, not merely quoted command text.
Coupled: components/session-state/src/runtime.ts
Verify: components/session-state/tests/tmux.test.ts, components/session-state/tests/coordinator.test.ts

## symbol:formatWindowName

Tmux window_set_name uses utf8_stravis with VIS_OCTAL|VIS_CSTYLE|VIS_TAB|VIS_NL: preserve valid UTF-8 and encode ASCII controls/backslashes in its observed label representation. Keep the raw authoritative person name unchanged. The argument first uses Node's UTF-8 replacement for unpaired surrogates and maps otherwise-unrepresentable NUL to the visible U+2400 control picture. Returning both the subprocess argument and expected label keeps reconciliation and its write boundary on one policy.
Why: backslash-only comparison rewrote stable TAB/ESC names every poll and reran user hooks; raw NUL cannot enter execFile argv. Verified against tmux 3.5a window.c, utf8.c and compat/vis.c from its primary source and disposable-server controls.
Coupled: components/session-state/src/runtime.ts
Verify: components/session-state/tests/coordinator.test.ts

## symbol:canonicalSocket

Socket paths are resolved with `realpath` everywhere they become keys: discovery and the path a bridge reports from `TMUX`.
Why: on macOS `/tmp` and `/var` are links into `/private`, and tmux reports the resolved path, so one server otherwise appeared under two keys.
Coupled: components/session-state/src/runtime.ts
Verify: components/session-state/tests/tmux.test.ts
