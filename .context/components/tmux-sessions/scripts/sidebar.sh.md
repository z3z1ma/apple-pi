## file

The script must exit 0 for every command, including `follow` when no sidebar is open.
Why: hooks call it through `run-shell -b`, and tmux shows "returned 1" on the client's status line for a non-zero exit, on every window switch.

The open sidebar's pane id lives in the server option `@pi_sidebar_pane`; `sidebar()` checks the pane still exists rather than clearing the option when the pane dies.
Why: tmux never reuses a pane id within a server, so a stale id cannot point at another pane.
Coupled: components/tmux-sessions/pi_session_manager.tmux

## symbol:last_pane

The sidebar must enter a window as its last pane: `split-window` and `join-pane` target `last_pane`, not the window.
Why: `select-layout` assigns panes to leaf cells in pane-list order, and tmux inserts a joined or split pane after its target in that list while `-f` puts its cell at the end of the layout tree. Any other target swaps the sidebar with an agent pane when the scaled layout is applied.
Coupled: components/tmux-sessions/sidebar/layout.py

## symbol:relayout

Every path that adds the sidebar to a window (`open`, `follow` in) reads that window's layout before the split or join and passes it to `layout.py add`; every path that removes it (`follow` away, `close`) reads the layout with the sidebar still in it and passes it to `layout.py remove`.
Why: the layout after tmux's own join or removal is already distorted (uneven shrink, all space to the rightmost pane), so scaling it would keep the drift.
Coupled: components/tmux-sessions/sidebar/layout.py
