## file

Exercise hire dates and recorded specialization through `openWorldBackend().snapshot()` for awake and dormant people, with a later incarnation and with both new columns physically absent. The shared sleeperCharacter adapter must preserve specialization too, since Org and profile use it to present stopped people. SQL here only arranges stored observations; the runtime hire lifecycle has its own suite.
Why: testing `projectWorld` with pre-populated DTOs could pass while the SQL column selection or row mapper silently lost every real hire date. A later start also distinguishes earliest observation from the current incarnation, without manufacturing a legacy hire date.
Coupled: apps/agent-world/src/backend/world-backend.ts, apps/agent-world/src/backend/projection.ts, components/session-state/src/schema.ts
Verify: apps/agent-world/tests/profile.test.ts, components/session-state/tests/hire-date.test.ts
