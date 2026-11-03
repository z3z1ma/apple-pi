## file

Needs you lists questions longest-waiting first, then finished and unseen. A working person leaves Needs you. Mail that starts a run keeps the earlier unseen settle. The record is completed assignments, not files touched. The operator's own sessions cannot retire. The map centre is the place centre within half a tile. Five feed lines show, newest at the bottom. `AGENT_WORLD_SHOTS` saves `aw-08-*.png`.
Why: counting a working person as still needing you would hide the question that is actually waiting.

Within a character row, the first `.aw-sr` span describes its state; a row with work text has another span for punctuation. Scope state assertions to the row and use `.locator(".aw-sr").first()`.
Why: an unqualified `.aw-sr` locator matches more than one element when the row has a task, so a strict-locator failure can look like a failed state update. The extra span is part of the row's accessible text, not duplicate state.
Coupled: apps/agent-workplace/web/overlay/interface/rows.tsx
Verify: apps/agent-workplace/tests/world-interface.test.ts
