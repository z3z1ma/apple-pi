## file

The script must exit 0 for every command, including `follow` when no sidebar is open.
Why: hooks call it through `run-shell -b`, and tmux shows "returned 1" on the client's status line for a non-zero exit, on every window switch.

The open sidebar's pane id lives in the server option `@pi_sidebar_pane`; `sidebar()` checks the pane still exists rather than clearing the option when the pane dies.
Why: tmux never reuses a pane id within a server, so a stale id cannot point at another pane.
Coupled: components/tmux-sessions/pi_session_manager.tmux
