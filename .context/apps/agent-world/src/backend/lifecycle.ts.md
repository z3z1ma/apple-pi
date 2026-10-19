## symbol:openLifecycle

Waking passes the sleeper's `reportsTo` in the `start` command, and aims it at the pane of the most recently active tmux client across every server in `tmux_servers`.
Why: Pi learns its coordinator only from `--reports-to` on its command line, so a worker woken without it would wake as an independent agent in the square; the runtime's `start` defaults only `cwd` and `name` from the stopped session.
Coupled: components/session-state/src/runtime.ts, apps/agent-world/src/backend/inn.ts
Verify: apps/agent-world/tests/inn.test.ts

Ending a session is refused with `confirm: true` while the character's run state is not `idle`, and nothing is sent; only `endSession(id, true)` sends `close` then. Each call resolves at the receipt stage that answers the operator (applied for wake and close; accepted-with-a-reason for mail that waits), not when the command settles, since mail to a dormant agent settles only when it wakes.
Why: decision 13 confirms interrupting a busy agent and nothing else; the command client (`commands.ts`) resolves only on applied or failed.
Coupled: apps/agent-world/src/backend/commands.ts, apps/agent-world/web/overlay/places/place-panels.ts
Verify: apps/agent-world/tests/inn.test.ts
