## symbol:PlaceScene.pointerUp

`drag` is cleared on the next tick, not right away.
Why: doors read `drag.moved` in their own pointerup so that ending a drag over a door doesn't travel. Phaser delivers game-object pointerup before the scene's, but clearing synchronously in the scene handler would still race with zones registered later.

## file

The read-only methods (`placeKey`, `figureViews`, `doorViews`, `galleryView`, `walkGridShown`, `lookAt`) are the surface the headless tests use through `window.agentWorldView`. Renaming one breaks seam 2 without a type error, because the tests reach it through `page.evaluate`.
Coupled: apps/agent-world/web/main.tsx
Verify: apps/agent-world/tests/world-ui.test.ts

Characters are drawn with frame 14 of their look's 16-frame strip, anchored at `baseline / frame[1]`, and scaled so a standing figure is `PERSON_TILES` tall. Coordinators draw from looks whose `role` is `coordinator`, and everyone else from `agent` looks, chosen by hashing the session id.
Coupled: apps/agent-world/themes/fantasy/characters/looks.json
