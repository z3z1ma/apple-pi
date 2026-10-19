## file

The read-only methods (`placeKey`, `figureViews`, `avatarView`, `doorViews`, `toScreen`, `toWorld`, `zoomView`, `galleryView`, `walkGridShown`, `lookAt`) are the surface the headless tests use through `window.agentWorldView`, and the interface's minimap reads `placeKey`, `figureViews`, `avatarView`, `toWorld`, and `walkGridShown` through `overlay/interface/world-link.ts`. Renaming one breaks them without a type error, because the tests reach it through `page.evaluate`.
Coupled: apps/agent-world/web/main.tsx, apps/agent-world/web/overlay/interface/world-link.ts
Verify: apps/agent-world/tests/world-ui.test.ts, apps/agent-world/tests/world-movement.test.ts

Characters are drawn with frame 14 of their look's 16-frame strip, anchored at `baseline / frame[1]`, and scaled so a standing figure is `PERSON_TILES` tall. Coordinators draw from looks whose `role` is `coordinator`, and everyone else from `agent` looks, chosen by hashing the session id. The avatar uses the first `avatar` look in `looks.json` order until Settings lets the operator choose one.
Coupled: apps/agent-world/themes/fantasy/characters/looks.json

The camera does not use Phaser's bounds or `startFollow`: `mid` (the world point at the view's centre) eases toward the avatar every frame and is clamped by `clampMid`, which centres a place smaller than the view. Phaser's `clampX` left-aligns a place narrower than the zoomed-out view instead of centring it. `toScreen` and `toWorld` derive from `scrollX` and `zoom` directly, so they agree with the frame drawn next without waiting for Phaser to update `worldView` in `preRender`.

## symbol:PlaceScene.intended

The scene carries out only the walking intents (`walk-to`, `go-to`, `walk-grid`). `main.tsx` carries out `travel`, `go-to`'s travel, and the side panel's `talk-to`, and the interface handles `examine` and `terminal`. A `go-to` to another place reaches both `main.tsx` and the scene. Whichever calls `travel` second adds the character to walk up to through `departure`, so the walk-up survives either order.
Coupled: apps/agent-world/web/main.tsx, apps/agent-world/web/view-state.ts

## symbol:PlaceScene.pointerUp

A left click runs the default action only if the press did not become a drag and did not close an open menu. Clicking off an open menu only closes it, as in RuneScape.
