## symbol:openLifecycle

Waking passes the sleeper's `reportsTo` in the `start` command, and aims it at the pane of the most recently active tmux client across every server in `tmux_servers`.
Why: the runtime owns the tree: it seeds `reports_to` from the flag at a session's first hello and keeps the recorded manager over any later flag, so the value sent here only matters for a session the runtime has never seen; a reopened person keeps its recorded manager either way. The runtime's `start` defaults only `cwd` and `name` from the stopped session.
Coupled: components/session-state/src/runtime.ts, apps/agent-world/src/backend/inn.ts
Verify: apps/agent-world/tests/inn.test.ts

Ending a session is refused with `confirm: true` while the character's run state is not `idle`, and nothing is sent; only `endSession(id, true)` sends `close` then. Wake and close resolve at applied, or report the last receipt when their wait expires. Mail is delegated to `openMailbox` in `mail.ts`: its thread post applies when stored, even if a recipient sleeps, and the receipt names sleeping recipients.
Why: decision 13 confirms interrupting a busy agent and nothing else; the command client (`commands.ts`) resolves only on applied or failed.
Coupled: apps/agent-world/src/backend/commands.ts, apps/agent-world/web/overlay/places/place-panels.ts
Verify: apps/agent-world/tests/inn.test.ts

Hiring (`recruit`) sends `start` for a fresh `randomUUID` session id with `cwd`, `name`, the brief as `prompt`, and the chosen `role`, which is checked against the catalog (`roles.ts`) before anything is sent. A person hired under a manager (`reportsTo`, any awake character: the backend does not know which roles manage) opens after that manager's own pane (`facts.tmux`), where the manager's `hire` tool opens its peers; an independent one opens after the operator's most recently active client pane, as waking does, with no `reportsTo`. A brief that starts with `-` is refused before anything is sent.
Why: the runtime puts the prompt on Pi's command line after the flags (`pi --session-id <id> --name <n> [--reports-to <c>] [--role <r>] <prompt>`), and Pi's argument parser reads a leading dash as an option; the runtime offers no `--` separator. The runtime also refuses an unknown role, but only after the window opened, so the catalog check here keeps a typo from opening a window that dies.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/coordinator.ts, apps/agent-world/src/backend/roles.ts, apps/agent-world/web/overlay/places/recruit-state.ts
Verify: apps/agent-world/tests/recruit.test.ts, apps/agent-world/tests/world-recruit.test.ts

Retiring (`retire`) sends the runtime's `retire` with a non-blank reason for an awake or a dormant character and resolves at `applied`; the runtime records the retirement and asks a running session to close itself, so the character leaves the world when its bridge goes, not when the receipt arrives.
Why: the runtime's `retire` is the one path that records `retired_at` and `retired_reason` (what the inn's leaving mark and the directory's former members read); sending `close` here instead would stop the session without marking it.
Coupled: components/session-state/src/runtime.ts, apps/agent-world/web/overlay/places/retire-state.ts, apps/agent-world/src/backend/inn.ts
Verify: apps/agent-world/tests/backend.test.ts, apps/agent-world/tests/world-rename.test.ts

Renaming (`rename`, ticket 12) collapses whitespace to one line, refuses a blank name, a name over `NAME_MAX` (60, in `world.ts`), or a character not in the snapshot before anything is sent, and resolves at `applied`. The world, the side panel, and the conversation panel show the new name only from the session's own `name` fact, which the bridge updates through `pi.setSessionName`; nothing here edits the snapshot.
Why: the rename form reads the same `NAME_MAX` for its `maxLength`, so the form and the backend cannot disagree; the recruit form still hard-codes 60.
Coupled: apps/agent-world/web/overlay/places/rename-state.ts, components/session-state/src/bridge.ts
Verify: apps/agent-world/tests/rename.test.ts, apps/agent-world/tests/world-rename.test.ts
