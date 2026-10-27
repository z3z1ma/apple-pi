## symbol:promoteLedgerTask

Promotion uses the same index validation, task-id reservation, and exclusive ledger lease as `ledger_add`. The caller holds the lease until its assignment transaction commits or rolls back. The source stays intact until commit, so a failed database change does not strand the goal under an unrecorded new path.
Coupled: components/session-state/src/work.ts
Verify: components/session-state/tests/work.test.ts, tests/ledger-add.test.ts
