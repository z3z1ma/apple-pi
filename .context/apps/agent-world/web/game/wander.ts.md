## file

Life (idles and wandering) runs on `lifePace()` from `character-life.ts`: `window.agentWorldLife = { pace }` speeds it up, and under a driven browser (`navigator.webdriver`, every headless test) it defaults to 0, so nobody idles or wanders. Tests that read positions, frames, or `moving` stay exact without knowing about life; a test of life sets the pace in an init script (`tests/world-life.test.ts`). Electron is never driven, so the app always lives at pace 1.
Why: wandering moves figures off their spots and idles swap textures at random moments; turning it on everywhere made the existing headless suites (written for still characters) racy.
Verify: apps/agent-world/tests/world-life.test.ts, apps/agent-world/tests/life.test.ts

Wanderers are not footprints in the avatar's walk grid (`PlaceScene.walkable` holds spots, not where anyone is now), so the avatar's path is always found; instead a wanderer goes home when the avatar comes within `GIVE_WAY` or ends its walk there, and `PlaceScene.approach` recalls whoever belongs at the point it walks up to (the avatar walks up to spots, not to where someone strolled). A host steps in a straight line (its post may be traced inside its counter's footprint, where pathing would not start).
Coupled: apps/agent-world/web/game/place-scene.ts, apps/agent-world/web/game/places/square.ts

Points of interest come from the place data (`interest`); the pack check keeps each a tile clear of doors' stand points and entries and clear of spots, host, and recruiter, which is what keeps a pausing wanderer off a doorstep. Agents go only to points within `reach` of their spot; a place whose points are all further has idle agents who never leave.
Coupled: apps/agent-world/src/theme-pack.ts, apps/agent-world/themes/README.md
Verify: apps/agent-world/tests/life-pack.test.ts
