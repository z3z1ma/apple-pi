## file

For dead-pane removal controls, set the scratch server's default shell explicitly and wait until tmux reports `pane_dead=1` before invoking removal. Exercise live and respawned controls separately.
Why: launching a short command and sleeping briefly left the pane alive in an isolated probe, so a successful conditional command did not prove its dead-pane branch ran.
Coupled: components/session-state/src/tmux.ts
