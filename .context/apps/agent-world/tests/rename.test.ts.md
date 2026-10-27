## file

The departure adapter case holds the command result while delivering an accepted receipt through Commands. It checks request/receipt behavior, not actual handoff, cleanup or database mutation; the real SDK lifecycle cases own those effects.
Why: reading an unchanged snapshot behind a mocked command, or checking the same already-returned object twice, cannot prove departure safety.
Coupled: apps/agent-world/src/backend/lifecycle.ts
Verify: components/session-state/tests/departure-lifecycle.test.ts
