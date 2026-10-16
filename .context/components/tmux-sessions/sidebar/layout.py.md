## symbol:scale

Widths come from cumulative rounding of each child's right edge, not from rounding each width on its own.
Why: the sidebar's `add` and `remove` run on every window switch; per-width rounding lets the sum miss the room by a column, and repeated round trips then drift a split. Cumulative rounding keeps the sum exact, and `add` followed by `remove` returns the original layout.

## symbol:remove

`remove` requires the sidebar to be the root's last side-by-side child and otherwise refuses (prints nothing).
Why: `sidebar.sh` puts it there (full-height join at the right, last in the pane list). If the operator moved or swapped it, rewriting the layout would assign panes to the wrong cells, so tmux's own reflow is the safer result.
Coupled: components/tmux-sessions/scripts/sidebar.sh
