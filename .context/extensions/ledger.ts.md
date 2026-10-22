## file

File transactions and history recording live in `components/shared/src/ledger-files.ts`, shared with explicit-task promotion. This extension owns Pi registration and observing changes to bundles. Touch history remains a transcript pointer, never an assignment. After archiving a registered task it sends `task_moved` to the runtime so the same assignment and focus still reach the file; an unregistered bundle needs no runtime call.
Why: a promotion must use the same ledger index and lease as `ledger_add`; the runtime stays a plain Node process and imports no Pi extension code.
Coupled: components/shared/src/ledger-files.ts
Verify: tests/ledger-history.test.ts, components/session-state/tests/work.test.ts
