## file

These integration cases use an isolated runtime/socket and the polling world backend; their assertions wait for public snapshots rather than treating a command receipt as immediate snapshot publication. Editing task.md to done does not end its live assignment: only the actual finish command removes held work from the board. The empty-schema case checks graceful absence of all workplace lists, including workHistory, rather than inventing historical work when an older daemon lacks the tables.
Why: runtime writes, file-derived metadata and the query-only snapshot have different update boundaries. Tests that equate file status with assignment completion or command acceptance with a refreshed snapshot would encode the wrong product behavior.

Coupled: apps/agent-world/src/backend/world-backend.ts, apps/agent-world/src/backend/workplace.ts, apps/agent-world/src/backend/facts.ts
Verify: apps/agent-world/tests/workplace.test.ts, apps/agent-world/tests/work-history.test.ts
