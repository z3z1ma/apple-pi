## file

The script starts the capture runtime before it launches Pi, and sends the prompt only after a fixed delay.
Why: `before_agent_start` builds `<org>` from the session's database row. If the request goes out before the bridge has registered the session, the session is not yet a recorded root: it gets the non-manager org text and no `pi-exec-peers` or `role-catalog`. The first captures differed this way between providers, and the cause was this race, not the provider.

Runtime cleanup reads the pid file again after each kill.
Why: while Pi exits, its bridge can respawn the runtime, which writes a new pid; killing only the first pid left a stray daemon on the capture database.

The temporary agent directory links every entry of the real one except `state/`, `sessions/` and `settings.json`, so the capture gets the real configuration in its own runtime and database and never joins the operator's organization. Its `settings.json` copy points the apple-pi package entry at the checkout that holds the script, so a copy run inside a worktree at an older commit captures that commit's prompt.
Why: the operator's settings name the main checkout as the package; a worktree run without the rewrite loaded the main checkout's extensions and captured today's prompt under the old commit's name.
Coupled: .ledger/202611032038-custom-system-prompt/current-prompt/render.mjs, components/organization/src/install.ts, components/session-state/src/paths.ts
