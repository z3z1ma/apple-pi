# What tmux and macOS expose for binding

Research for [What tmux and macOS expose for binding sessions to panes and processes](../decisions/02-what-tmux-and-the-os-expose.md). Read-only scout on this Mac, 2026-10-18 (tmux 3.5a). A scratch tmux server tested control mode; the operator's server was only read.

## tmux

- Ids: server = socket path (`#{socket_path}`, for example `/private/tmp/tmux-502/default`); session `$N` (`#{session_id}`) and name; window `@N`; pane `%N`. Ids are only meaningful within one server, so a binding key includes the socket path.
- Pane facts: `#{pane_pid}` (the first process in the pane, usually a shell, not Pi), `#{pane_tty}`, `#{pane_current_command}` (for example `node` for Pi), `#{pane_current_path}`, `#{pane_dead}`, `#{pane_active}`, `#{window_active}`.
- Clients: `list-clients -F '#{client_tty} #{client_session} #{window_id} #{pane_id} #{client_flags}'` shows which pane each attached client displays. No per-client focus boolean format was found; focus comes from `pane-focus-in`/`-out` hooks with `focus-events on`.
- Several servers: sockets live in `/private/tmp/tmux-$UID/`; stale socket files remain after a server exits (two of three here had no server), so each candidate must be queried.
- Change notification: hooks (`session-created`, `session-closed`, `session-renamed`, `window-linked`, `window-unlinked`, `window-renamed`, `pane-exited`, `pane-died`, `pane-focus-in`/`-out`, `client-attached`, `client-detached`, `client-session-changed`, `client-focus-in`/`-out`) and control mode (`tmux -C`), which streamed `%session-changed`, `%window-add`, `%window-pane-changed`, `%layout-change`, and `%exit` on the scratch server. A natural pane exit (`%pane-exited`) was not exercised.

## Processes

- Pi runs as a child of the pane's shell: `pane_pid 73965 (fish -c pi --session-id orchard-work …) → 73982 pi`, and `90065 → 90084 fish → 90163 pi`. Binding needs the process tree, not `pane_pid` alone.
- `ps -o pid,ppid,lstart,command` gives parent pid, start time (a pid-reuse guard), and command line; `lsof -a -p <pid> -d cwd -Fn` gives cwd. `proc_pidinfo` (libproc) exists for native code; its local documentation was not found.
- Inside Pi, the extension already knows its own pid, `TMUX`, and `TMUX_PANE`, which binds session to pane without any process scan.

## Cost (mean wall time, 10 runs)

| Call | Mean |
| --- | --- |
| `tmux list-panes -a -F …` | 8.1 ms |
| `ps -A -o pid,ppid,lstart,command` (all processes) | 22.1 ms |
| `ps -o … -p <pid>` (one process) | 4.0 ms each |
| `lsof -p <pid> -d cwd -Fn` (one process) | 90.7 ms each |

One `tmux list-panes` plus one `ps -A` per second costs about 30 ms. Per-pid `lsof` is too slow for a one-second loop; cwd is better reported by the bridge.

## Gaps

Id uniqueness across servers not verified (treat as per-server); `%pane-exited` not exercised; no 20-pane benchmark; libproc details not verified locally.
