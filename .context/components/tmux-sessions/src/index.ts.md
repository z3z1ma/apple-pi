## file

Temporary program peers keep normal tmux integration but leave routine completion attention to their caller. Their automatic bell is quiet; the notify extension still reports a question needing the operator.
Coupled: components/notify/src/index.ts, components/session-state/src/protocol.ts
Verify: components/tmux-sessions/tests/tmux-sessions.test.ts

## symbol:ensurePlugin

The `@pi_sessions_plugin` stamp is the plugin's path plus its modification time.
Why: a path alone would keep an updated package's old hooks and bindings until the tmux server restarts.

It also sets `@pi_agent_dir` to Pi's agent directory.
Why: the sidebar and dashboard run from the tmux server's environment, which does not see a `PI_CODING_AGENT_DIR` exported only to Pi, and they read the session-state database under it.
Coupled: components/tmux-sessions/scripts/sidebar.sh, components/tmux-sessions/pi_session_manager.tmux
Verify: components/tmux-sessions/tests/tmux-sessions.test.ts
