## file

An idle shows a frame of the look's idle sheet, a separate texture (`look:<look>:idle`, loaded by `boot-scene.ts` when the look has `idle`), with its own frame size and baseline; the walker swaps texture and origin for it and back. `view().frame` keeps reporting the main sheet's frame (14 while an idle plays) and `idle`/`idleFrame` say what shows, so tests that expect frame 14 for standing stay true. An idle plays only standing still facing down (the poses are drawn facing the viewer), never seated, busy, asking, or asleep, and anything that moves or turns the walker ends it.
Coupled: apps/agent-world/web/game/boot-scene.ts, apps/agent-world/themes/fantasy/characters/looks.json

`Walker.playing` is shared by every walker (static): someone starting an idle picks one nobody else is playing, which is what keeps neighbours out of step. Entries of walkers whose sprite is gone (a scene that shut down without destroying them) are dropped when it is read. `playIdle` checks every path against it, a named idle (the ambient cast's reaction gesture) as well as a picked one, and plays nothing when the idle is taken. There are only seven idles and the anime-school square can have more standing about (townsfolk, agents, host, recruiter, ambient cast), so when every idle but its last is taken `IdleClock.pick` returns none and the character waits for its next turn.
Why: a fallback that picks among taken idles once all are busy puts two characters in the square on the same idle, which `world-life.test.ts` (anime-school) catches.
Coupled: apps/agent-world/web/game/character-life.ts, apps/agent-world/web/game/ambient.ts
Verify: apps/agent-world/tests/life.test.ts, apps/agent-world/tests/world-life.test.ts
