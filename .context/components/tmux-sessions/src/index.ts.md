## symbol:ensurePlugin

The plugin load runs as its own queued task after `init` has written the session's record, never inside `init`.
Why: a missing plugin file or a failing `tmux run-shell` must not stop status publishing; the queue swallows its errors.

The `@pi_sessions_plugin` stamp is the plugin's path plus its modification time.
Why: a path alone would keep an updated package's old hooks and bindings until the tmux server restarts.

It also sets `@pi_state_dir` to this extension's `STATE_DIR`.
Why: the sidebar runs from the tmux server's environment, which does not see a `PI_TMUX_STATE_DIR` exported only to Pi.
Coupled: components/tmux-sessions/scripts/sidebar.sh, components/tmux-sessions/pi_session_manager.tmux
Verify: components/tmux-sessions/tests/tmux-sessions.test.ts
