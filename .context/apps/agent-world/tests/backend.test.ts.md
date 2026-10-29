## file

The permanent-departure case uses the recorded departure event as a fixture synchronization barrier, then stops the fake bridge before asserting public snapshot removal from both awake and dormant rosters and the reduced team headcount. The lifecycle receipt is acceptance, not completion. The stand-in bridge does not automatically quit when the runtime requests departure; a snapshot-only wait before stopping it therefore stalls.
Why: the barrier lets the asynchronous departure commit before the fixture performs the shutdown a real bridge would handle. The observable contract remains removal from the retained roster after departure, distinct from ordinary at-home state; the event query is harness sequencing rather than a new product requirement.
Coupled: apps/agent-world/src/backend/lifecycle.ts, apps/agent-world/src/backend/world-backend.ts, components/session-state/src/runtime.ts
Verify: apps/agent-world/tests/backend.test.ts
