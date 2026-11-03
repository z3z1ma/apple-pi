## file

Rename uses the backend API over a real session-state runtime and the real bridge. It sends the runtime `rename` command and resolves with its receipt. The new name is then the character's in the world snapshot.
Why: the figure, side panel and conversation panel all read that snapshot; a local label would not prove the command.

The departure adapter case holds the command result while delivering an accepted receipt through Commands. It checks request/receipt behavior, not actual handoff, cleanup or database mutation; the real SDK lifecycle cases own those effects.
Why: reading an unchanged snapshot behind a mocked command, or checking the same already-returned object twice, cannot prove departure safety.
Coupled: apps/agent-workplace/src/backend/lifecycle.ts
Verify: components/session-state/tests/departure-lifecycle.test.ts
