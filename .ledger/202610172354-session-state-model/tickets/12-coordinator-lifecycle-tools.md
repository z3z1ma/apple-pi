# 12: Coordinator lifecycle tools

**What to build:** A coordinator extension gives the coordinator session tools to start a session in a tmux window (cwd, name, `reportsTo`, first prompt), reopen a stopped session by id, and close a session, each as a command through its bridge with receipts. The `coordinator` skill uses these tools instead of raw `tmux new-window` and `agents.py list`.

**Blocked by:** 02 tmux topology and pane binding; 08 Command channel

**Status:** done

- [x] On a scratch tmux server, the start tool opens a new window running a Pi session with the given id, name, cwd, `reportsTo`, and first prompt, and its receipt reaches applied when that session's bridge connects.
- [x] The reopen tool restarts a stopped session by id as a new incarnation with its history.
- [x] The close tool ends a session; the database shows the incarnation exited.
- [x] The `coordinator` skill text instructs these tools and no longer mentions `tmux new-window` or `agents.py list`.
