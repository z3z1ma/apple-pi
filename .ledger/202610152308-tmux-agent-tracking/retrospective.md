Status: done
Created: 2026-10-15
Updated: 2026-10-16

# Retrospective

## What Mattered

- Looking at the operator's real setup first (loose panes, no plugin loaded, empty session names) reframed the job from "sidebar instead of popup" to attention and identity.
- A throwaway prototype on live data, with structurally different variants in a real tmux pane, settled the design in two short rounds.
- Testing tmux behaviour on a scratch server with an attached pty client caught real defects: drifting splits, unzooming, hook error messages, detached sessions taking the sidebar.

## Learnings

- tmux state is per server but the agent records are shared: anything that reads or prunes records must check the record's server (`tmuxSocket`) and pane tty. Run scratch-server tests with a temporary `PI_TMUX_STATE_DIR`; a test against the real directory deleted every live record.
- `select-layout` assigns panes in pane-list order; a pane joined with `-f` must be the last pane, or the rewritten layout swaps panes.
- Textual on a translucent terminal needs `ansi_color=True`, `background: ansi_default`, and solid (alpha-free) text colours.
- Treat a rename as metadata, not a status change, or automatic titles reopen agents you just saw.
- A new identity field in shared persistent records needs a policy for records written before it existed: here, records without `tmuxSocket` are shown only when their pane tty matches and are never pruned for a missing pane.

## Improvements

- Make a status-only field the reader's source for "unseen" and keep timestamps of other changes out of it from the start.
- When a pair or reviewer flags a data-safety concern about shared state, fix it before running any test that touches that state.
