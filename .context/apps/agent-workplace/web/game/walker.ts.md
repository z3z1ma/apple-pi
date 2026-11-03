## file

Advance stride by distance, preserve it when replacing a path, and spend the remaining frame distance across corners. Resting directions use passing frames because the sheet has a true standing pose only facing front; mirror only walking and sideways-resting poses. Desynchronize seated beats, preserve facing near diagonal runs, and anchor busy breathing at the feet.
Why: these constraints prevent sliding feet, corner stalls, mirrored authored poses, synchronized rooms, diagonal flicker and sprites lifting off the floor.

An idle shows a frame of the look's idle sheet, a separate texture (`look:<look>:idle`, loaded by `boot-scene.ts` when the look has `idle`), with its own frame size and baseline; the walker swaps texture and origin for it and back. `view().frame` keeps reporting the main sheet's frame (14 while an idle plays) and `idle`/`idleFrame` say what shows, so tests that expect frame 14 for standing stay true. An idle plays only standing still facing down (the poses are drawn facing the viewer), never seated, busy, asking, or asleep, and anything that moves or turns the walker ends it.
Coupled: apps/agent-workplace/web/game/boot-scene.ts, apps/agent-workplace/themes/fantasy/characters/looks.json

`Walker.playing` is shared by every walker (static): someone starting an idle picks one nobody else is playing, which is what keeps neighbours out of step. Entries of walkers whose sprite is gone (a scene that shut down without destroying them) are dropped when it is read. `playIdle` checks every path against it, a named idle (the ambient cast's reaction gesture) as well as a picked one, and plays nothing when the idle is taken. There are only seven idles and the anime-school square can have more standing about (townsfolk, agents, host, recruiter, ambient cast), so when every idle but its last is taken `IdleClock.pick` returns none and the character waits for its next turn.
Why: a fallback that picks among taken idles once all are busy puts two characters in the square on the same idle, which `world-life.test.ts` (anime-school) catches.
Coupled: apps/agent-workplace/web/game/character-life.ts, apps/agent-workplace/web/game/ambient.ts
Verify: apps/agent-workplace/tests/life.test.ts, apps/agent-workplace/tests/world-life.test.ts
