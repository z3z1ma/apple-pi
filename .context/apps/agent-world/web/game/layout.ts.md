## symbol:layoutFor

A wing uses `wing-large` exactly when its headcount exceeds the number of spots in `wing-small.json`, so adding or removing a spot there moves the switch point.
Why: the ticket ties the room size to "more agents than the small room has spots", not to a fixed number.
Coupled: apps/agent-world/themes/fantasy/places/wing-small.json
Verify: apps/agent-world/tests/world-ui.test.ts

The gallery's `niches.layouts` and `niches.repeat` are painting-derived tile ranges. A layout or the repeat strip that starts or ends off a seamless column shows a visible seam, even though the blend hides a few pixels.
Why: the painting has exactly five niches; fewer wings come from cut layouts and more from repeating the 1067–1359 px section (in a 1774 px painting).
Coupled: apps/agent-world/themes/fantasy/places/gallery.json, apps/agent-world/web/game/place-scene.ts

The meeting room reuses the common-room painting and floor data, but has its own place key, an exit back to the gallery, and no copied ambient crew. Keeping the crew out prevents the same named staff from appearing in two rooms of one headquarters. Its permanent gallery niche follows the wing niches, so a meeting stays reachable when no meeting is open and existing wing order stays stable.
Coupled: apps/agent-world/src/theme-pack.ts, apps/agent-world/src/world.ts, apps/agent-world/web/overlay/interface/model.ts
Verify: apps/agent-world/tests/world-ui.test.ts, apps/agent-world/tests/world-places.test.ts

## symbol:doorOf

A wing's door follows team membership, not temporary meeting attendance. It is boarded only when it has neither awake nor dormant workers; `dormant` comes from the backend projection (stopped sessions reporting to the coordinator in that repository). The layout signature includes the door state, so a change of state restarts the gallery scene.
Coupled: apps/agent-world/src/backend/projection.ts
Verify: apps/agent-world/tests/backend.test.ts, apps/agent-world/tests/world-places.test.ts

## symbol:assignSpots

A character keeps its spot for as long as the app runs (the scene passes in the previous map), and new arrivals take free spots in session-start order.
Why: nobody should jump when someone else arrives or leaves; the order comes from the backend sorting characters by first start.
Verify: apps/agent-world/tests/world-ui.test.ts
