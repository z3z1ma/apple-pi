## file

A file is replaced through a sibling temporary so readers never see a truncated index. Live bundles are under the session directory and every ancestor that holds a `.ledger/`.
Why: promotion reads and validates every source and destination before changing `task.md`, stages the destination path before changing task metadata, and restores indexes before returning the bundle and its original status.

## symbol:promoteLedgerTask

Promotion uses the same index validation, task-id reservation, and exclusive ledger lease as `ledger_add`. The caller holds the lease until its assignment transaction commits or rolls back. The source stays intact until commit, so a failed database change does not strand the goal under an unrecorded new path.
Coupled: components/session-state/src/work.ts
Verify: components/session-state/tests/work.test.ts, tests/ledger-add.test.ts
