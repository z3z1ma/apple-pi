## symbol:openLifecycle

Waking passes the sleeper's `reportsTo` in the `start` command, and aims it at the pane of the most recently active tmux client across every server in `tmux_servers`.
Why: the runtime owns the tree: it seeds `reports_to` from the flag at a session's first hello and keeps the recorded manager over any later flag, so the value sent here only matters for a session the runtime has never seen; a reopened person keeps its recorded manager either way. The runtime's `start` preserves the stopped session's `cwd`, name, role, and focus.
Coupled: components/session-state/src/runtime.ts, apps/agent-world/src/backend/inn.ts
Verify: apps/agent-world/tests/inn.test.ts

Ending a session is refused with `confirm: true` while the character's run state is not `idle`, and nothing is sent; only `endSession(id, true)` sends `close` then. Wake and close resolve at applied, or report the last receipt when their wait expires. Mail is delegated to `openMailbox` in `mail.ts`: its thread post applies when stored, even if a recipient sleeps, and the receipt names sleeping recipients.
Why: decision 13 confirms interrupting a busy agent and nothing else; the command client (`commands.ts`) resolves only on applied or failed.
Coupled: apps/agent-world/src/backend/commands.ts, apps/agent-world/web/overlay/places/place-panels.ts
Verify: apps/agent-world/tests/inn.test.ts

Hiring (`recruit`) sends `start` for a fresh id with `cwd`, name, the chosen catalog-checked role, and a written goal assigned by `operator`. A role hire requires the goal and can omit its name: `start` leaves naming to the normal session-title extension. An unroled session still requires a name and can open without work. A named manager must be running; query-only runtime records must grant managing capability or show an unroled independent root. Temporary and retired managers are refused even when a stale snapshot appears eligible. A supplied goal is stored as a task before Pi starts, not passed as a raw CLI prompt. A person under a manager opens beside that manager's pane; an independent one opens beside the operator's most recently active client pane.
Why: the first turn must already have an assignment. Keeping the goal in its file also means a leading dash is ordinary goal text, not a CLI option.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/coordinator.ts, apps/agent-world/src/backend/roles.ts, apps/agent-world/web/overlay/places/recruit-state.ts
Verify: apps/agent-world/tests/recruit.test.ts, apps/agent-world/tests/world-recruit.test.ts, apps/agent-world/tests/add-person.test.ts

Retiring (`retire`) requests permanent departure as `operator` and returns acceptance while the runtime owns the person's own-session handoff and subsequent cleanup. `follow` preserves the received stage instead of rewriting acceptance as applied. The UI relays the pending note and waits for authoritative snapshots; completed departure creates no dormant former person. A later runtime outcome reports failure or completion.
Why: command acceptance, durable handoff, membership ending and proven resource cleanup are separate boundaries. Waiting on the old blocking handover makes the new asynchronous API appear hung; reporting acceptance as applied falsely claims cleanup.
Legacy former rows remain available to read but `wake` refuses them before locating a pane or sending `start`. Ordinary dormancy keeps its existing wake behavior; this neither purges legacy state nor creates a reactivation path.
Coupled: components/session-state/src/runtime.ts, apps/agent-world/web/overlay/places/retire-state.ts, apps/agent-world/src/backend/inn.ts
Verify: apps/agent-world/tests/backend.test.ts, apps/agent-world/tests/rename.test.ts, apps/agent-world/tests/world-rename.test.ts

Renaming (`rename`, ticket 12) collapses whitespace to one line, refuses a blank name, a name over `NAME_MAX` (60, in `world.ts`), or a character not in the snapshot before anything is sent, and resolves at `applied`. The world, the side panel, and the conversation panel show the new name only from the session's own `name` fact, which the bridge updates through `pi.setSessionName`; nothing here edits the snapshot.
Why: the rename form reads the same `NAME_MAX` for its `maxLength`, so the form and the backend cannot disagree; the recruit form still hard-codes 60.
Coupled: apps/agent-world/web/overlay/places/rename-state.ts, components/session-state/src/bridge.ts
Verify: apps/agent-world/tests/rename.test.ts, apps/agent-world/tests/world-rename.test.ts
