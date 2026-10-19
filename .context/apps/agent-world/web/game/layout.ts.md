## symbol:layoutFor

A wing uses `wing-large` exactly when its headcount exceeds the number of spots in `wing-small.json`, so adding or removing a spot there moves the switch point.
Why: the ticket ties the room size to "more agents than the small room has spots", not to a fixed number.
Coupled: apps/agent-world/themes/fantasy/places/wing-small.json
Verify: apps/agent-world/tests/world-ui.test.ts

The gallery's `niches.layouts` and `niches.repeat` are painting-derived tile ranges. A layout or the repeat strip that starts or ends off a seamless column shows a visible seam, even though the blend hides a few pixels.
Why: the painting has exactly five niches; fewer wings come from cut layouts and more from repeating the 1067–1359 px section (in a 1774 px painting).
Coupled: apps/agent-world/themes/fantasy/places/gallery.json, apps/agent-world/web/game/place-scene.ts

## symbol:assignSpots

A character keeps its spot for as long as the app runs (the scene passes in the previous map), and new arrivals take free spots in session-start order.
Why: nobody should jump when someone else arrives or leaves; the order comes from the backend sorting characters by first start.
Verify: apps/agent-world/tests/world-ui.test.ts
