## file

Within a character row, the first `.aw-sr` span describes its state; a row with work text has another span for punctuation. Scope state assertions to the row and use `.locator(".aw-sr").first()`.
Why: an unqualified `.aw-sr` locator matches more than one element when the row has a task, so a strict-locator failure can look like a failed state update. The extra span is part of the row's accessible text, not duplicate state.
Coupled: apps/agent-world/web/overlay/interface/rows.tsx
Verify: apps/agent-world/tests/world-interface.test.ts
