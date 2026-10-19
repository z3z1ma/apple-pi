## file

The read-only methods (`placeKey`, `figureViews`, `avatarView`, `doorViews`, `toScreen`, `toWorld`, `zoomView`, `galleryView`, `overlayViews`, `bannerViews`, `walkGridShown`, `lookAt`) are the surface the headless tests use through `window.agentWorldView`, and the interface's minimap reads `placeKey`, `figureViews`, `avatarView`, `toWorld`, and `walkGridShown` through `overlay/interface/world-link.ts`. Renaming one breaks them without a type error, because the tests reach it through `page.evaluate`.
Coupled: apps/agent-world/web/main.tsx, apps/agent-world/web/overlay/interface/world-link.ts
Verify: apps/agent-world/tests/world-ui.test.ts, apps/agent-world/tests/world-movement.test.ts, apps/agent-world/tests/world-places.test.ts

Every character is a `Walker` (the avatar's walker too), anchored at `baseline / frame[1]` and scaled so a standing figure is `PERSON_TILES` tall. Its pose at rest follows its status (`character-life.ts`): working sits (frames 12-13, which draw their own seat, so spots are just south of a table), asking raises a hand (15), anything else stands (14). Coordinators draw from looks whose `role` is `coordinator`, everyone else from `agent` looks, chosen by `lookFor` in `web/looks.ts`, shared with the conversation panel's portraits; the avatar wears `avatarLookIn` (the snapshot's `avatarLook`, else the pack's first avatar look).
Coupled: apps/agent-world/themes/fantasy/characters/looks.json, apps/agent-world/web/game/character-life.ts

Only a world change after `create` animates: a character new to the place appears just inside its `enterBy` door and walks to its spot, and one that left walks out by it and stays in `figures` (flagged `leaving`) until it is through. `figureViews` and `characterNames` leave those out (the minimap and the tests count only who is there); `departingViews` lists them. A scene restart (the layout's signature changed) places everyone at once.
Verify: apps/agent-world/tests/world-characters.test.ts

`foreground` pieces are cut from the painting texture and drawn at depth `feet * TILE - 0.5`, so they cover anyone whose feet are north of `feet`. Blocked rects trace only a piece of furniture's floor footprint, which lets characters stand behind it; a piece's rect must not include floor around the furniture, or it erases legs with floor.
Coupled: apps/agent-world/themes/fantasy/places/

The camera does not use Phaser's bounds or `startFollow`: `mid` (the world point at the view's centre) eases toward the avatar every frame and is clamped by `clampMid`, which centres a place smaller than the view. Phaser's `clampX` left-aligns a place narrower than the zoomed-out view instead of centring it. `toScreen` and `toWorld` derive from `scrollX` and `zoom` directly, so they agree with the frame drawn next without waiting for Phaser to update `worldView` in `preRender`.

`clampMid` lets the painting slide out by the interface's insets (measured from the DOM by `interfaceInsets` every 300 ms by class name: `.aw-side`, `.aw-top-right`, `.aw-chat`, `.place-title`), so a door under a panel can be brought into the open. Renaming those classes silently turns the slack off.
Coupled: apps/agent-world/web/overlay/interface/interface.css
Verify: apps/agent-world/tests/world-places.test.ts

## symbol:PlaceScene.banner

The banner sprite's cloth is only the middle of the image: the vine border bounds the text to about 0.48 of the sprite's width, and the swallowtail starts near 0.75 of its height. Names go on one line down to 12 px, else on up to four lines broken after separators, then at 10 px with long words hyphenated (U+2010, which the tests strip) and an ellipsis as the last resort.
Coupled: apps/agent-world/themes/fantasy/overlays/banner-cream.png
Verify: apps/agent-world/tests/world-places.test.ts

## symbol:PlaceScene.intended

The scene carries out the walking intents (`walk-to`, `go-to` including its travel to another place, `walk-grid`). `main.tsx` carries out only `travel` and the side panel's `talk-to`, and the interface handles `examine` and `terminal`. Handling `go-to` or `walk-grid` in `main.tsx` as well would travel twice or toggle the grid back off.
Coupled: apps/agent-world/web/main.tsx, apps/agent-world/web/view-state.ts

## symbol:PlaceScene.pointerUp

A left click runs the default action only if the press did not become a drag and did not close an open menu. Clicking off an open menu only closes it, as in RuneScape.
