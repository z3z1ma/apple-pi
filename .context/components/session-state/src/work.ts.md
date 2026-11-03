## file

`WorkCommand.tmux` is the operator's attached terminal. The operator has no incarnation, so the UI supplies the pane a wake opens beside. `opened_at` is null for a task recorded before that column existed, not a task that is not an obligation. `changeWork` notifies the changed person even when that person wrote the thread post.
Why: a manager wake uses the assigning session's pane, filling a missing opening time would invent history, and authoring the task-thread message is not the same as hearing the assignment change.

Assignments and focus are runtime records; `task.md` remains the only goal text. Task-thread participants retain implicit session/task relationships, including ledger creation and status callers without assignments. Participation is not ownership or proof of contribution: managers can be notification recipients. Reuse the existing idempotent participation/audience-event path; file edits create no task metadata. File changes happen in the runtime's work transaction, before its thread message and outgoing notifications commit. Finishing an ephemeral task closes it in place: its bundle path and artifacts remain stable, and `archived_at` records closure rather than a directory move. Only explicit promotion copies to a destination, retains the source until commit, and records source cleanup in `work_changes` for restart. Legacy finish cleanup receipts are cleared without deleting their original directories or changing their recorded archive destinations. Caught failures roll back the assignment and filesystem changes together. A process crash inside uncommitted file changes fails closed on restart, with an explicit request to inspect the files, rather than guessing whether an unfinished ledger publication can be replayed.
Why: moving the source before recording the new path can leave an assignment pointing at a missing goal, while reporting completion before its outbox commits can lose the assigner's outcome. Original task paths are also artifact references: preserving an archive copy does not preserve those references, and a pending legacy cleanup can erase evidence written after that copy.
Coupled: components/session-state/src/runtime.ts, components/shared/src/ledger-files.ts, components/session-state/src/work-tools.ts
Verify: components/session-state/tests/work.test.ts, components/session-state/tests/work-recovery.test.ts

## symbol:closeTask

The operator (or a manager of every holder) closes an ephemeral task for everyone on it: open assignments end as `unassigned`, focus clears, `Status:` in task.md becomes done or cancelled, and the bundle stays in place like a finish. Ledger tasks are refused; their close is `ledger_status` moving the bundle, which `closeLedgerTask` records.
Verify: components/session-state/tests/work.test.ts

## symbol:cleanMovedBundles

Temporary-peer disposal records explicit `discard` receipts only after process-death proof. Those receipts use this same recovery owner as promotion moves. Leaving them pending strands program scopes even after every person and process is gone; clearing them without deleting the owned bundle falsely acknowledges cleanup. Historical `finish` receipts still preserve their original files.
Verify: components/session-state/tests/program-peers.test.ts, components/session-state/tests/work-recovery.test.ts
Coupled: components/session-state/src/program-peers.ts

## symbol:closeLedgerTask

The close is recorded once (`coalesce`), and `archived_at` means "closed" for ledger tasks too, not only "moved to the state history". A ledger task the runtime never recorded opens and closes in the same call, for the sender's organization, so a never-assigned task still leaves its record.
Coupled: extensions/ledger.ts, docs/session-state.md
Verify: components/session-state/tests/work.test.ts

## symbol:writeOutcome

The assignment id identifies its outcome section. A task shared by several assignees closes only after its last open assignment finishes; finishing one person's assignment leaves the other person's goal open. Even after final completion, all task artifacts remain at the same paths.
Verify: components/session-state/tests/work.test.ts
