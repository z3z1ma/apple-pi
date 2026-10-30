## file

Seeded journal snapshots model two startup boundaries: accepted before mutation, and committed effect+outbox before terminal receipt. They prove actual-runtime recovery, not an OS crash/power-loss experiment. A revoked private member still receives the already-addressed queued message once; new access is not restored. A SQLite outbox trigger proves lifecycle/message/result rollback together.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/communication.ts, components/session-state/src/communication-actions.ts
Verify: components/session-state/tests/communication-recovery.test.ts
