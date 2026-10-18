Type: research
Status: resolved
Blocked by: 

# What tmux and macOS expose for binding sessions to panes and processes

## Question

What can a local process learn from tmux and macOS to bind a Pi session to its pane and process, and to notice changes quickly?

Cover, with sources: tmux identifiers and formats (server socket, `$session`, `@window`, `%pane`, `pane_pid`, `pane_tty`, `pane_current_command`, `pane_dead`, client and focus state), several tmux servers on one machine, change notification (hooks, `tmux -C` control mode events, polling cost), and process facts on macOS (pid, parent pid, start time as a pid-reuse guard, command line, cwd) through `ps`, `lsof`, or `libproc`. Include the cost of each at a one-second cadence with about twenty panes.

## Answer

Findings: [tmux and process binding](../research/tmux-and-process-binding.md).

- tmux ids are per server: a pane key is socket path plus `%pane`. `pane_pid` is the shell, and Pi is its child, so binding needs the process tree, or simply the bridge's own `process.pid` and `TMUX_PANE`.
- Changes are available from tmux hooks and from control mode (`tmux -C`) as a stream; stale sockets must be probed to find live servers.
- One `tmux list-panes -a` plus one `ps -A` costs about 30 ms; per-process `lsof` (about 90 ms each) is too slow for a one-second loop, so cwd should come from the bridge.
