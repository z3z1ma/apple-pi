## symbol:recordHistory

`history.json` holds only `{ "sessions": [...] }`: sessions with a transcript that touched the task. It is a touch record, not an assignment record.
Why: commit recording for history replay was removed when replay was shelved; the session links stayed as the bundle's own record.
Verify: tests/ledger-history.test.ts

## symbol:promoteLedgerTask

Promotion uses the same index validation, task-id reservation, and exclusive ledger lease as `ledger_add`. The caller holds the lease until its assignment transaction commits or rolls back. The source stays intact until commit, so a failed database change does not strand the goal under an unrecorded new path.
Coupled: components/session-state/src/work.ts
Verify: components/session-state/tests/work.test.ts, tests/ledger-add.test.ts
