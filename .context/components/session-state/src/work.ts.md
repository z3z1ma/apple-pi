## file

Assignments and focus are runtime records; `task.md` remains the only goal text. Task-thread participants retain implicit session/task relationships, including ledger creation and status callers without assignments. Participation is not ownership or proof of contribution: managers can be notification recipients. Reuse the existing idempotent participation/audience-event path; file edits create no task metadata. File changes happen in the runtime's work transaction, before its thread message and outgoing notifications commit. Finishing an ephemeral task closes it in place: its bundle path and artifacts remain stable, and `archived_at` records closure rather than a directory move. Only explicit promotion copies to a destination, retains the source until commit, and records source cleanup in `work_changes` for restart. Legacy finish cleanup receipts are cleared without deleting their original directories or changing their recorded archive destinations. Caught failures roll back the assignment and filesystem changes together. A process crash inside uncommitted file changes fails closed on restart, with an explicit request to inspect the files, rather than guessing whether an unfinished ledger publication can be replayed.
Why: moving the source before recording the new path can leave an assignment pointing at a missing goal, while reporting completion before its outbox commits can lose the assigner's outcome. Original task paths are also artifact references: preserving an archive copy does not preserve those references, and a pending legacy cleanup can erase evidence written after that copy.
Coupled: components/session-state/src/runtime.ts, components/shared/src/ledger-files.ts, components/session-state/src/work-tools.ts
Verify: components/session-state/tests/work.test.ts, components/session-state/tests/work-recovery.test.ts

## symbol:closeLedgerTask

The close is recorded once (`coalesce`), and `archived_at` means "closed" for ledger tasks too, not only "moved to the state history". A ledger task the runtime never recorded opens and closes in the same call, for the sender's organization, so a never-assigned task still leaves its record.
Coupled: extensions/ledger.ts, docs/session-state.md
Verify: components/session-state/tests/work.test.ts

## symbol:writeOutcome

The assignment id identifies its outcome section. A task shared by several assignees closes only after its last open assignment finishes; finishing one person's assignment leaves the other person's goal open. Even after final completion, all task artifacts remain at the same paths.
Verify: components/session-state/tests/work.test.ts
