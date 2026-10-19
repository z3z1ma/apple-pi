## file

The read-only methods (`placeKey`, `figureViews`, `avatarView`, `doorViews`, `toScreen`, `toWorld`, `zoomView`, `galleryView`, `overlayViews`, `bannerViews`, `paintingFrames`, `filterView`, `walkGridShown`, `lookAt`, `hostView`) are the surface the headless tests use through `window.agentWorldView`, and the interface's minimap reads `placeKey`, `figureViews`, `avatarView`, `toWorld`, and `walkGridShown` through `overlay/interface/world-link.ts`. Renaming one breaks them without a type error, because the tests reach it through `page.evaluate`.
Coupled: apps/agent-world/web/main.tsx, apps/agent-world/web/overlay/interface/world-link.ts
Verify: apps/agent-world/tests/world-ui.test.ts, apps/agent-world/tests/world-movement.test.ts, apps/agent-world/tests/world-places.test.ts

Every character is a `Walker` (the avatar's walker too), anchored at `baseline / frame[1]` and scaled so a standing figure is `PERSON_TILES` tall. Its pose at rest follows its status (`character-life.ts`): working sits (frames 12-13, which draw their own seat, so spots are just south of a table), asking raises a hand (15), anything else stands (14). Out of doors (the square) working is `busy` instead: standing (14) with a slow breath in its vertical scale, since the seated frames would draw a stool in the street. Coordinators draw from looks whose `role` is `coordinator`, everyone else from `agent` looks, chosen by `lookFor` in `web/looks.ts`, shared with the conversation panel's portraits; the avatar wears `avatarLookIn` (the snapshot's `avatarLook`, else the pack's first avatar look).
Coupled: apps/agent-world/themes/fantasy/characters/looks.json, apps/agent-world/web/game/character-life.ts

Only a world change after `create` animates: a character new to the place appears just inside its `enterBy` door and walks to its spot, and one that left walks out by it and stays in `figures` (flagged `leaving`) until it is through. `figureViews` and `characterNames` leave those out (the minimap and the tests count only who is there); `departingViews` lists them. A scene restart (the layout's signature changed) places everyone at once.
Verify: apps/agent-world/tests/world-characters.test.ts

`foreground` pieces are cut from the painting texture and drawn at depth `feet * TILE - 0.5`, so they cover anyone whose feet are north of `feet`. Blocked rects trace only a piece of furniture's floor footprint, which lets characters stand behind it; a piece's rect must not include floor around the furniture, or it erases legs with floor. A piece's bottom edge is its `feet` line (`places.test.ts` checks it), so a sloping rail is traced as several narrow pieces stepping down with it (the guild hall's weapon rack).
In the fantasy pack, open floor never lies behind a desk or table: their pieces hide nobody, and the occlusion that shows is tall things with floor behind them, found by walking the avatar to just north of every interior blocked rect.
Coupled: apps/agent-world/themes/fantasy/places/

The scene reads the theme through a getter (`worn()` from `theme-store.ts`), never a copy: switching theme stops it, removes every texture (cut frames and canvases too, since their keys do not name the theme), loads the new pack in `BootScene`, and starts it again on the same place, so nothing drawn from the old pack survives.
Coupled: apps/agent-world/web/main.tsx, apps/agent-world/web/game/boot-scene.ts

The painting is added by its `__BASE` frame. Foreground pieces are frames of the same texture, and the texture's default frame is the first one added, so a later visit that added the image without a frame stretched a desk over the whole place.
Verify: apps/agent-world/tests/world-places.test.ts

`refilter` sets each texture's filter (`painting`, `look`, `overlay`, `water`, `bed` keys) from its on-screen scale on every zoom change: nearest at or above `CRISP_FROM`, linear below, so pixel art stays crisp zoomed in and the painting does not shimmer zoomed out. `applyCamera` rounds the scroll to whole screen pixels and `Walker.snap` rounds moving sprites, so nothing swims while the camera eases.
Verify: apps/agent-world/tests/world-places.test.ts

The camera does not use Phaser's bounds or `startFollow`: `mid` (the world point at the view's centre) eases toward the avatar every frame and is clamped by `clampMid`, which centres a place smaller than the view. Phaser's `clampX` left-aligns a place narrower than the zoomed-out view instead of centring it. `toScreen` and `toWorld` derive from `scrollX` and `zoom` directly, so they agree with the frame drawn next without waiting for Phaser to update `worldView` in `preRender`.

`followMid` keeps a place that fits the window along a side centred along it, and slides it only as far as it takes to bring the avatar out from under a panel; following the avatar there made a room seen whole drift with every step.

`clampMid` lets the painting slide out by the interface's insets (measured from the DOM by `interfaceInsets` every 300 ms by class name: `.aw-side`, `.aw-top-right`, `.aw-chat`, `.place-title`), so a door under a panel can be brought into the open. Renaming those classes silently turns the slack off.
Coupled: apps/agent-world/web/overlay/interface/interface.css
Verify: apps/agent-world/tests/world-places.test.ts

## symbol:PlaceScene.banner

The banner sprite's cloth is only part of the image, so the pack measures where its name goes and where it answers the pointer (`world.banner.text` and `hover`, fractions of the sprite in `theme.json`): in fantasy the vine border bounds the text to about 0.48 of the sprite's width (0.42 leaves a margin), and the swallowtail starts near 0.75 of its height; the tech office's sign plate and the anime school's plaque are wide, short boards with their own text areas. Names go on one line from 15 px down to 13 px, else on as many lines (broken after separators) as fit, from 15 px down to 12 px. A name still too long at 12 px has each word that does not fit cut to at most six letters ending on a consonant, with a full stop ("custom. ident."), on up to five lines, an ellipsis as the last resort; `BannerView.abbreviated` says so, and hovering the banner (`bannerRects`) shows the full name.
Why: the polish pass for tickets 11 and 17 (the polish bar in Further Notes of `.ledger/202610171741-guildworld/spec.md`) set 12 px as the smallest size that reads at the default zoom; the old 10 px hyphenated names did not.
Coupled: apps/agent-world/themes/fantasy/overlays/banner-cream.png, apps/agent-world/themes/fantasy/theme.json
Verify: apps/agent-world/tests/world-places.test.ts

## symbol:PlaceScene.intended

The scene carries out the walking intents (`walk-to`, `go-to` including its travel to another place, `walk-grid`). `main.tsx` carries out only `travel` and the side panel's `talk-to`, and the interface handles `examine` and `terminal`. Handling `go-to` or `walk-grid` in `main.tsx` as well would travel twice or toggle the grid back off.
Coupled: apps/agent-world/web/main.tsx, apps/agent-world/web/view-state.ts

## symbol:PlaceScene.pointerUp

A left click runs the default action only if the press did not become a drag and did not close an open menu. Clicking off an open menu only closes it, as in RuneScape.

## symbol:PlaceScene.sleep

At the inn the figures are the newest dormant agents (`charactersIn` with the inn's spot count), not awake characters: each dozes in its seated frame (`dozing`) or, on a spot a `bed` overlay slot names, lies in that bed (`in-bed`: the walker is hidden at rest and a head cut from frame 14 is drawn on the pillow under a quilt cut from the bed sprite along the pack's `world.bed.covers` polygon). A sleeper that is still dormant but pushed past the spots leaves by the stairs (the door whose `to` is `rooms`); one that woke leaves by the front door; one coming down from upstairs enters by the stairs.
Why: the ticket shows only as many sleepers as the painting holds, newest first, and the rest "upstairs"; `world.bed.pillow` and `world.bed.covers` in each pack's `theme.json` are pixel positions in its `overlays/bed.png`, so a repainted bed needs them measured again.
Coupled: apps/agent-world/themes/fantasy/places/inn.json, apps/agent-world/themes/fantasy/overlays/bed.png, apps/agent-world/themes/fantasy/theme.json, apps/agent-world/web/game/layout.ts
Verify: apps/agent-world/tests/world-inn.test.ts

## symbol:PlaceScene.flyNewMail

Only mail whose id was not in the snapshot when the scene was created, and sent within the last two minutes, flies as a bird; the scene restarts on every travel or layout change, so mail is "new" relative to the current visit. Sender and receiver are looked up among figures present (or the avatar for `operator`); one side missing makes the bird use the `enterBy` door; in the rookery every new letter comes in by the `window` slot to the host.
Why: a reconnect or the first snapshot would otherwise launch a flock for old mail; the ticket shows traffic between characters in the current place, or out by the door when the receiver is elsewhere.
Coupled: apps/agent-world/web/game/birds.ts, apps/agent-world/src/backend/mail.ts
Verify: apps/agent-world/tests/world-rookery.test.ts
