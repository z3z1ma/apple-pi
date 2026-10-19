## symbol:switchToPane

The operator's client is the most recently active client (`client_activity`) of the pane's own server, and one `switch-client -c <tty> -t <pane id>` selects the pane's session, window, and pane at once.
Why: a pane id names its session and window, so separate `select-window`/`select-pane` calls would resolve against whichever session tmux guesses when the window is linked into several. With no client attached the result says so instead of failing silently.
Verify: apps/agent-world/tests/backend.test.ts

Tests switch a client of a scratch server (`tmux -L <name> -f /dev/null`) attached through a Python `pty.fork()`, never the operator's server; `TMUX_TMPDIR` from `tempStateDir` keeps the runtime reading only that directory.
Verify: apps/agent-world/tests/backend.test.ts
