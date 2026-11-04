## file

Hooks are set at the fixed array index `71`, never appended.
Why: the Pi extension may run this file again (an updated plugin reloads), and `set-hook -ga` would add a duplicate each time. A fixed index replaces the plugin's own hook and leaves the operator's hooks on the same events alone.
Coupled: components/tmux-sessions/src/index.ts

When testing on a scratch tmux server, do not set `window-size manual`: tmux 3.5a crashes on `new-window` in a detached session with that option.

Testing tmux behavior without touching the operator's server:
- Use `tmux -L <name> -f /dev/null new-session -d -x W -y H`. When hooks need an attached client, attach one through a Python `pty.fork()` running `tmux -L <name> attach`. Screenshot panes from `capture-pane -e -p` through Rich `Text.from_ansi`, `save_svg`, then Playwright.
- Point `PI_CODING_AGENT_DIR` at a temporary directory, so a scratch runtime and its database stay apart from the operator's.
- A window that `tmux new-window` opens takes the PATH of the tmux client that ran the command, not the server's (`-e PATH` does not help). A debug `tmux new-window ... pi` from an agent shell started the operator's real Pi, which joined his live runtime; test such commands with a fake `pi` first on the PATH of the process that runs tmux.
- To isolate a live Pi run, start the first pane with `env PATH=<wrapper dir>:$PATH` under `default-shell /bin/sh`, and run `pi --no-mcp` (`-xt 'mcp__*'` leaves the resource tools and still connects servers) with `PI_CODING_AGENT_SESSION_DIR` (subagents ignore `--session-dir`). Probe all three before a paid run.
- Check a binding with `tmux list-keys -T prefix <key>` before telling the operator it exists.
- Give every tmux call a timeout with a kill (`timeout -k 5 N`): plain SIGTERM did not stop a client waiting on a stopped server.

The extension reruns this plugin only when its path-plus-mtime stamp changes, not on every Pi start; read that guard before a plan relies on a hook firing.
Coupled: components/tmux-sessions/src/index.ts
