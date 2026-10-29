## symbol:dormantAgents

Temporary-identity metadata comes from the backend session row, independently of the person's reporting line. A named identity event must refresh that row before dormant reconciliation; the existing row-object cache then rebuilds the affected sleeper even when its visible role and manager stayed the same.
Why: dormant reconciliation can keep the prior object between task-file reads. Reusing a row after its identity evidence changes would keep stale Org eligibility until a full refresh.
Coupled: apps/agent-world/src/backend/world-backend.ts, components/session-state/src/program-peers.ts
Verify: apps/agent-world/tests/temporary-metadata.test.ts
