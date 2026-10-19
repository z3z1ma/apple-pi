## symbol:WorldIntent

Intents are a broadcast: the interface handles `examine` and `terminal` itself (whoever sends them, so the world's right-click menu can send them too); the world must handle `walk-to`, `travel`, `go-to`, `talk-to`, and `walk-grid`. `main.tsx` wires the world's side until the game subscribes itself: `travel` and `go-to` through `PlaceScene.travel`, `talk-to` through `conversations.open` (no walking), `walk-grid` through a synthetic G key, and `walk-to` not at all yet.
Why: ticket 06 owned the game while ticket 08 built the interface; the intents keep the two apart, and a kind nobody handles does nothing.
Coupled: apps/agent-world/web/main.tsx, apps/agent-world/web/overlay/interface/interface.tsx
Verify: apps/agent-world/tests/world-interface.test.ts

## symbol:MinimapView

The minimap is published by `publishMinimap` (`overlay/interface/world-link.ts`) from the scene's read-only views every 150 ms, only when it changes; positions are in the place's tiles, and a growing place (the gallery) sends its strips so the minimap draws the same cut painting.
Coupled: apps/agent-world/web/overlay/interface/world-link.ts, apps/agent-world/web/game/layout.ts
Verify: apps/agent-world/tests/world-interface.test.ts
