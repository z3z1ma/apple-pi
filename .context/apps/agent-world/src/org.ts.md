## file

The guards validate the IPC payload shape, while the controller/runtime retain semantic validation such as roles, cycles, work safety and stale branches. Optional position fields are strings when present, and a null manager is an explicit independent head or split. A shape-valid object can still carry extra keys; consumers construct authorized command fields explicitly rather than forwarding the whole object.
Why: payload shape is independent of today's reporting tree. The same valid move may be safe or blocked depending on current assignments, so the guard cannot own that decision or authorize extra fields.

Progress distinguishes pending/preparing work from ready/active people and from failed/blocked/uncertain outcomes. Only editable=true authorizes the renderer to unlock a failed draft: the backend proved rejection occurred before preparation and found no prior correlated plan commands. Missing/false stays frozen; empty person IDs alone are not evidence of no side effects. Returned position/person identities let the renderer retry the same draft without inventing another person; receiving an event is not evidence that a kickoff or start was applied.
Why: a move of an already-awake person can change the organization without creating a new person or launch. The explicit journal-backed editability signal prevents the UI from treating that partial operation as an untouched draft.

Coupled: apps/agent-world/src/backend/org.ts, apps/agent-world/src/electron/main.ts, apps/agent-world/src/electron/preload.ts, apps/agent-world/src/world.ts
Verify: apps/agent-world/tests/org-api.test.ts, apps/agent-world/tests/org-backend.test.ts, apps/agent-world/tests/org-runtime.test.ts
