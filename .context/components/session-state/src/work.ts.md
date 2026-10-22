## file

Assignments and focus are runtime records; `task.md` remains the only goal text. File changes happen in the runtime's work transaction, before its thread message and outgoing notifications commit. Archive and promotion copy to the destination first, retain the source until commit, and remember source cleanup in `work_changes` so a restart completes it. Caught failures roll back the assignment and filesystem changes together. A process crash inside uncommitted file changes fails closed on restart, with an explicit request to inspect the files, rather than guessing whether an unfinished ledger publication can be replayed.
Why: moving the source before recording the new path can leave an assignment pointing at a missing goal, while reporting completion before its outbox commits can lose the assigner's outcome.
Coupled: components/session-state/src/runtime.ts, components/shared/src/ledger-files.ts, components/session-state/src/work-tools.ts
Verify: components/session-state/tests/work.test.ts, components/session-state/tests/work-recovery.test.ts

## symbol:writeOutcome

The assignment id identifies its outcome section. A task shared by several assignees archives only after its last open assignment finishes; finishing one person's assignment leaves the other person's goal in place.
Verify: components/session-state/tests/work.test.ts
