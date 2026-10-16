## file

The script must exit 0 for every command, including `follow` when no sidebar is open.
Why: hooks call it through `run-shell -b`, and tmux shows "returned 1" on the client's status line for a non-zero exit, on every window switch.

The open sidebar's pane id lives in the server option `@pi_sidebar_pane`; `sidebar()` checks the pane still exists rather than clearing the option when the pane dies.
Why: tmux never reuses a pane id within a server, so a stale id cannot point at another pane.
Coupled: components/tmux-sessions/pi_session_manager.tmux

## symbol:restore_layout

Every path that removes the sidebar from a window (`follow` away, `close`) must call `restore_layout` for that window, and every path that adds it (`open`, `follow` in) must call `remember_layout` first.
Why: tmux shrinks panes unevenly when the sidebar joins and gives all the space back to the rightmost pane when it leaves, so without the saved layout a vertical split drifts left on every window switch. `select-layout` rejects a saved layout whose pane count no longer matches, which leaves tmux's reflow in place.
