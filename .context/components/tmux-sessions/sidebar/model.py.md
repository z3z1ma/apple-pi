## symbol:agent_dir

An empty `PI_CODING_AGENT_DIR` means the default `~/.pi/agent`, and only a leading `~` or `~/` means home, as in the runtime.
Why: the sidebar and dashboard panes are started with `-e PI_CODING_AGENT_DIR=<@pi_agent_dir>`, which is empty when the option is unset; reading another directory than the runtime shows no sessions and sends commands nowhere.
Coupled: components/tmux-sessions/scripts/sidebar.sh, components/session-state/src/paths.ts

## symbol:live

This server's socket from tmux is compared after `os.path.realpath`.
Why: the runtime stores tmux sockets by resolved path (`/tmp` is `/private/tmp` on macOS); the raw path matches nothing.
Verify: components/tmux-sessions/sidebar/tests/test_sidebar.py

The views never mark a session seen because its pane is focused.
Why: the runtime marks a session seen when a tmux client shows its pane; the views only send `mark_seen` for an explicit `x` or for reading it in the dashboard.

## symbol:Store.poll

Tool history is folded from `tool_started` events after the last `seq` read, not re-queried each poll.
Why: `events` is append-only with no index on session or type, so a per-poll scan would grow with the whole history; `seq` is its primary key.
