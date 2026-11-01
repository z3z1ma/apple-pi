## file

A batch ID identifies one confirmed reason and per-person handoff selection. The backend derives stable runtime command IDs from it; uncertain recovery carries the same payload rather than generating another departure. Every member's handoff is explicit, unlike the single-person API's omitted-means-true default.
Why: changing approval while retaining an operation ID conflicts with runtime replay, while losing an explicit false can start an unwanted paid handoff.

The shape guard validates required fields, not authority or an allowed-key whitelist. The backend constructs operator retire commands from those fields. A finished batch can contain failed, blocked or uncertain people; only applied means completed departure.
Why: accepted/delivered receipts precede cleanup, and a settled batch pass is not proof that every person was removed.

Coupled: apps/agent-world/src/backend/departures.ts, apps/agent-world/src/electron/main.ts, apps/agent-world/src/electron/preload.ts, apps/agent-world/web/workplace-departures.tsx
Verify: apps/agent-world/tests/departures.test.ts, apps/agent-world/tests/world-lifecycle.test.ts
