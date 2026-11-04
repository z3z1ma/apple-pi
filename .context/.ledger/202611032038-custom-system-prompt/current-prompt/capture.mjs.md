## file

The script starts the capture runtime before it launches Pi, and sends the prompt only after a fixed delay.
Why: `before_agent_start` builds `<org>` from the session's database row. If the request goes out before the bridge has registered the session, the session is not yet a recorded root: it gets the non-manager org text and no `pi-exec-peers` or `role-catalog`. The first captures differed this way between providers, and the cause was this race, not the provider.

Runtime cleanup reads the pid file again after each kill.
Why: while Pi exits, its bridge can respawn the runtime, which writes a new pid; killing only the first pid left a stray daemon on the capture database.

The temporary agent directory links every entry of the real one except `state/` and `sessions/`, so the capture gets the real configuration in its own runtime and database and never joins the operator's organization.
Coupled: .ledger/202611032038-custom-system-prompt/current-prompt/render.mjs, components/organization/src/install.ts, components/session-state/src/paths.ts
