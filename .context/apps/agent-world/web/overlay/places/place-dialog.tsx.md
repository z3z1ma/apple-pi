## symbol:dialogLayer

A layer over the open panel (the outside-write confirmation, `ConfirmWrite`) registers here, and the panel's `close` (Escape, its close button, a click on the dimmed world) dismisses the top layer instead of closing the panel; so Escape over a confirmation declines the write and keeps the issue, review, or thread the operator was writing on.
Why: `PlaceDialog` handles Escape in a window capture listener added when the panel opened, and window capture listeners run in the order they were added, so a listener the confirmation adds later never sees Escape first.
Coupled: apps/agent-world/web/overlay/places/outside-write.tsx
Verify: apps/agent-world/tests/world-quest-library.test.ts, apps/agent-world/tests/world-forge.test.ts
