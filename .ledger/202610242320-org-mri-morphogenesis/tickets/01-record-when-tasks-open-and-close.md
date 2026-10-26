# 01: Record when tasks open and close

Part of the approved spec [../spec.md](../spec.md); its Terms table defines obligation, completion, window, horizon, scenario, impact, and the other words used here.

**What to build:** The runtime records, once per task and organization, when the task became an obligation and when it closed and how (`done` or `cancelled`). A task opens when it is created: `ledger_add` (the ledger extension tells the runtime, for the creating session's organization), or `take_task`, `assign`, or `hire` with a goal. A ledger task closes when `ledger_status` moves it to history with `Status: done` or `Status: cancelled`; the ledger extension tells the runtime about every close, including a task nobody was ever assigned. An ephemeral task closes `done` when its last assignee finishes; it has no cancellation, because unassigning leaves it open. A task created before these records existed opens when first recorded (taken, assigned, or closed). Today a ledger close leaves only a path-only `task_moved` event, and only for tasks already registered, so this fact is new; fitness history reads these records instead of current files. `docs/session-state.md` describes them.

**Blocked by:** None (can start immediately).

**Status:** done (c53cb61a)

- [x] Through faux sessions against a spawned runtime, `ledger_add` records an open for the creating session's organization at creation time; before this ticket nothing in the database shows it.
- [x] An ephemeral task with three assignees gets one close record, `done`, at the time the last one finishes, and none before.
- [x] Closing a registered ledger task `done` and another `cancelled` with `ledger_status` gives each one close record with that status and time; the bundle path update still happens.
- [x] An unassigned ledger task that is later assigned, completed, and archived has the same open and close records whether read before or after the archive; a task never assigned and closed directly also gets both records.
- [x] A fresh database and one at the previous schema version both migrate to the new version without losing rows.
