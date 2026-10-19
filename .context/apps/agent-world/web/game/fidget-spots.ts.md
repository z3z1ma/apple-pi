## symbol:standPoints

A fidget on furniture is walked up to from the union of every blocked rect under its base, so its first choice is the front edge of that whole union. A fidget at the edge of a big footprint (the fantasy square bell on the fountain's rim pillar) then sends the avatar to the far front of the fountain, over 2.3 tiles away. Give the supporting part its own blocked rect, with the large rects starting past it, so the union under the fidget is just that part.
Why: place data alone shows nothing of this; ticket 02 of the alive pass moved the bell and the world-fidgets walk-up check failed until the fountain's rects were split.
Coupled: apps/agent-world/themes/fantasy/places/square.json
Verify: apps/agent-world/tests/world-fidgets.test.ts, apps/agent-world/tests/depth.test.ts

A floor fidget is walked up to from beside it, a body's width off, and only last from square in front: pets are drawn to scale now (ticket 03 of the alive pass), and the avatar standing in front of a hedgehog or a calico hid it whole.
Verify: apps/agent-world/tests/world-pets.test.ts

## symbol:fidgetScale

A pet's size comes from the pack's `height` (a share of a standing character, `PERSON_TILES` in `walker.ts`) measured on its first (`sit`) sprite, not from a width: the art is painted at any size, and width-based scaling drew every cat half a person tall. A slot's `w` still wins, so a pack can size one pet by hand.
Coupled: apps/agent-world/web/game/walker.ts, apps/agent-world/src/theme-pack.ts
Verify: apps/agent-world/tests/pets.test.ts, apps/agent-world/tests/world-pets.test.ts
