## file

This is operator UI orchestration over existing retire commands, not a second departure authority. The runtime owns eligibility, handoff, irreversible departure and cleanup. Order selected people by recorded ancestry, and await applied cleanup before sending a selected ancestor. Failure/uncertainty blocks that selected branch; unrelated branches may continue. Unselected people are never added, moved or reassigned. A concurrent reporting change can cause a runtime refusal; the batch is progressive, not atomic.

Each confirmed UI batch fixes its reason and per-person handoff booleans. The existing command journal owns replay; stable per-person command IDs are reused on uncertainty. Concurrent identical calls coalesce in memory; conflicting live calls are refused. No batch journal or new retry attempt is created. The UI retains its request across Hide/tab changes, not reload/app quit. A new explicit selection creates a new batch ID. Applied receipts describe completed departure, unlike acceptance or committed-but-pending cleanup.

The main process closes this owner before closing Commands, so quitting cannot start the remaining selected people after the current send settles. Accepted individual departures are daemon-owned and continue. Reloading the renderer leaves the main-process batch running but loses its display; the renderer's shared leave guard warns while pending/uncertain. This is not durable restartable queue ownership.

Coupled: apps/agent-world/src/backend/commands.ts, components/session-state/src/runtime.ts, apps/agent-world/src/departures.ts, apps/agent-world/src/electron/main.ts, apps/agent-world/web/workplace-departures.tsx
Verify: apps/agent-world/tests/departures.test.ts, components/session-state/tests/departure-lifecycle.test.ts
