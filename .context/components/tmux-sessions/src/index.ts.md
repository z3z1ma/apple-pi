## symbol:ensurePlugin

The plugin load runs as its own queued task after `init` has written the session's record, never inside `init`.
Why: a missing plugin file or a failing `tmux run-shell` must not stop status publishing; the queue swallows its errors.

The `@pi_sessions_plugin` stamp is the plugin's path plus its modification time.
Why: a path alone would keep an updated package's old hooks and bindings until the tmux server restarts.

It also sets `@pi_state_dir` to this extension's `STATE_DIR`.
Why: the sidebar runs from the tmux server's environment, which does not see a `PI_TMUX_STATE_DIR` exported only to Pi.
Coupled: components/tmux-sessions/scripts/sidebar.sh, components/tmux-sessions/pi_session_manager.tmux
Verify: components/tmux-sessions/tests/tmux-sessions.test.ts

## symbol:piTmuxSessions

`updatedAt` changes only with the status, not with a rename (`session_info_changed`).
Why: the sidebar counts an idle agent updated after you last looked at its pane as unseen. Automatic session titles arrive a moment after the turn settles, so bumping `updatedAt` on rename put agents you had just watched back into NEEDS YOU.
Verify: components/tmux-sessions/tests/tmux-sessions.test.ts

Every record write and removal runs `sidebar.sh status` in the background, so the tmux status-line summary follows status changes without polling.
Coupled: components/tmux-sessions/scripts/sidebar.sh

The `reports-to` flag is registered before the child-session and `PI_TMUX_DISABLED` returns.
Why: Pi exits with "Unknown option" on a flag no extension registered, so a worker started with `--reports-to` under `PI_TMUX_DISABLED=1` would not start.

The close notice text is what the Orchard skill tells the Orchard to expect; change both together.
Coupled: skills/orchard/SKILL.md, docs/tmux-sessions.md
