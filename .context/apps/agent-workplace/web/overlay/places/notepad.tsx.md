## file

Save against the last successfully read/saved base text. A disk conflict blocks further saves until explicit resolution; cleanup attempts to flush edits but keeps that conflict guard.
Why: navigation must not discard pending text or turn a close-time flush into an overwrite of another writer's changes.
Coupled: apps/agent-workplace/web/overlay/places/notepad-state.ts
Verify: apps/agent-workplace/tests/notepad.test.ts, apps/agent-workplace/tests/world-notepad.test.ts
