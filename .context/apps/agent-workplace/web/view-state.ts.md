## file

Replace the view state object on each update.
Why: useSyncExternalStore subscribers detect changed snapshot identity, not mutation within the existing object.

## symbol:WorldIntent

Intents broadcast to every subscriber. `PlaceScene.intended` owns `walk-to`, `go-to` (including travel to another place), and `walk-grid`. `main.tsx` owns `travel`, `talk-to` (opening a conversation without walking), and `choose-theme`; the interface owns `examine`, `terminal`, and `open-tab`.
Why: broadcast does not select a single handler. Duplicating a scene-owned intent in main can travel twice or toggle the walk grid back off.
Coupled: apps/agent-workplace/web/main.tsx, apps/agent-workplace/web/game/place-scene.ts, apps/agent-workplace/web/overlay/interface/interface.tsx
Verify: apps/agent-workplace/tests/world-interface.test.ts

`choose-theme` (Settings) is carried out by `main.tsx`: it checks the pack, switches live, and only then keeps the choice through `store.setTheme`, so a broken pack is never stored as the operator's theme. A snapshot whose `theme` differs from the one worn (chosen elsewhere) switches too, except to a pack already found broken in this window.
Coupled: apps/agent-workplace/web/main.tsx, apps/agent-workplace/web/world-store.ts
Verify: apps/agent-workplace/tests/world-themes.test.ts

## symbol:MinimapView

The minimap is published by `publishMinimap` (`overlay/interface/world-link.ts`) from the scene's read-only views every 150 ms, only when it changes; positions are in the place's tiles, and a growing place (the gallery) sends its strips so the minimap draws the same cut painting.
Coupled: apps/agent-workplace/web/overlay/interface/world-link.ts, apps/agent-workplace/web/game/layout.ts
Verify: apps/agent-workplace/tests/world-interface.test.ts
