## symbol:openLifecycle

Waking passes the sleeper's `reportsTo` in the `start` command, and aims it at the pane of the most recently active tmux client across every server in `tmux_servers`.
Why: Pi learns its coordinator only from `--reports-to` on its command line, so a worker woken without it would wake as an independent agent in the square; the runtime's `start` defaults only `cwd` and `name` from the stopped session.
Coupled: components/session-state/src/runtime.ts, apps/agent-world/src/backend/inn.ts
Verify: apps/agent-world/tests/inn.test.ts

Ending a session is refused with `confirm: true` while the character's run state is not `idle`, and nothing is sent; only `endSession(id, true)` sends `close` then. Each call resolves at the receipt stage that answers the operator (applied for wake and close; accepted-with-a-reason for mail that waits), not when the command settles, since mail to a dormant agent settles only when it wakes.
Why: decision 13 confirms interrupting a busy agent and nothing else; the command client (`commands.ts`) resolves only on applied or failed.
Coupled: apps/agent-world/src/backend/commands.ts, apps/agent-world/web/overlay/places/place-panels.ts
Verify: apps/agent-world/tests/inn.test.ts

Recruiting (`recruit`, ticket 10) sends `start` for a fresh `randomUUID` session id with `cwd`, `name`, and the brief as `prompt`. A worker's window opens after its coordinator's own pane (`facts.tmux`), where the coordinator's `start_session` tool opens its peers, and carries `reportsTo`; an independent agent's opens after the operator's most recently active client pane, as waking does, with no `reportsTo`. A brief that starts with `-` is refused before anything is sent.
Why: the runtime puts the prompt on Pi's command line after the flags (`pi --session-id <id> --name <n> [--reports-to <c>] <prompt>`), and Pi's argument parser reads a leading dash as an option; the runtime offers no `--` separator.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/coordinator.ts, apps/agent-world/web/overlay/places/recruit-state.ts
Verify: apps/agent-world/tests/recruit.test.ts

Renaming (`rename`, ticket 12) collapses whitespace to one line, refuses a blank name, a name over `NAME_MAX` (60, in `world.ts`), or a character not in the snapshot before anything is sent, and resolves at `applied`. The world, the side panel, and the conversation panel show the new name only from the session's own `name` fact, which the bridge updates through `pi.setSessionName`; nothing here edits the snapshot.
Why: the rename form reads the same `NAME_MAX` for its `maxLength`, so the form and the backend cannot disagree; the recruit form still hard-codes 60.
Coupled: apps/agent-world/web/overlay/places/rename-state.ts, components/session-state/src/bridge.ts
Verify: apps/agent-world/tests/rename.test.ts, apps/agent-world/tests/world-rename.test.ts
