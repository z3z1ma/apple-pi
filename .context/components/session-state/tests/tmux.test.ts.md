## file

`TMUX_TMPDIR` holds the scratch `-L` servers, so the runtime sees only those and never the operator's. The path tmux was asked for, through macOS's `/var` alias, is not the resolved path the runtime keys servers by.
Why: a test that uses the operator's tmux server would attach to his sessions, and an alias path would miss the row the runtime stored.

For dead-pane removal controls, set the scratch server's default shell explicitly and wait until tmux reports `pane_dead=1` before invoking removal. Exercise live and respawned controls separately.
Why: launching a short command and sleeping briefly left the pane alive in an isolated probe, so a successful conditional command did not prove its dead-pane branch ran.
Coupled: components/session-state/src/tmux.ts
