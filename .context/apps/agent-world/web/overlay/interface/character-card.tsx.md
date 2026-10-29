## symbol:factRows

The Focused task row is the current explicit assignment; Record lists titles of tasks the person finished, supplied by the backend from assignments. A task can appear in both when it was finished before and later reassigned.
Why: editing a ledger file is no longer evidence that someone worked on it; completion records and current focus mean different things.
The workplace profile reuses these observed fact rows with its own navigation controls and compact status, rather than importing World-only character actions.
Coupled: apps/agent-world/src/backend/world-backend.ts, components/session-state/src/schema.ts, apps/agent-world/web/workplace-people.tsx
Verify: apps/agent-world/tests/world-interface.test.ts, apps/agent-world/tests/backend.test.ts
