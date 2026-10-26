## file

File transactions and history recording live in `components/shared/src/ledger-files.ts`, shared with explicit-task promotion. This extension owns Pi registration and observing changes to bundles. Touch history remains a transcript pointer, never an assignment. `ledger_add` sends `task_opened`, and closing any task as `done` or `cancelled` sends `task_moved` with the status, registered or not, so the runtime records each task's open and close once; the same assignment and focus still reach the archived file. Both are skipped when `PI_SESSION_STATE_DISABLED=1` or no state database exists.
Why: a promotion must use the same ledger index and lease as `ledger_add`; the runtime stays a plain Node process and imports no Pi extension code. Fitness history needs every open and close as a recorded fact: before, a never-assigned task left nothing behind when archived. Gating only on the database's existence let Vitest suites outside session-state reach the operator's live runtime, because his state directory exists.
Coupled: components/shared/src/ledger-files.ts
Verify: tests/ledger-history.test.ts, components/session-state/tests/work.test.ts
