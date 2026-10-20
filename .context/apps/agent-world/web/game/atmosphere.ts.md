## file

Effects move only at `lifePace()`, which is 0 under webdriver unless the page sets `window.agentWorldLife`. Every effect must still be drawn the moment a place opens: falling particles start part-way through their life so `shown` is never empty.
Why: headless screenshots and tests run with life still. An effect that only appears once it moves is invisible there, and world-atmosphere.test.ts fails on `shown` being 0.

Daylight tests move the page clock with `page.clock.setSystemTime`, never `setFixedTime`.
Why: Phaser's tweens measure time with `Date.now()`. A fixed clock freezes the glow flicker and lamp fades that the night check reads, so night glows look no brighter than day.

Out of doors the tint is one MULTIPLY rectangle at `TINT_DEPTH` (-0.95): over the painting and what lies flat in it (seams, water at -1, the square's sign plates), under everything that stands on it. Every sprite from there up to `NIGHT_TOP` (8e4: people, pets, fidgets, foreground pieces, overlays, particles, Text, and Container children) is instead multiplied by the daylight colour one by one in `shade`, a pass over the display list on the scene's PRE_RENDER, over whatever tint its own code set (remembered in `shaded`; a tint changed by its code since becomes its own). Lights registered with `keepLit` are skipped: each `lights` rect's piece of the painting's bright, warm pixels and its ADD halo, sorted at the rect's bottom edge (`feet * TILE - 0.45`, just over a foreground piece with the same feet), and the scene's glows, sorted by `glowDepth` (over the piece they sit on, over a facade's lit pieces, else at their own line; a fidget's glow just over the fidget). Badges, tags, bubbles, fidget FX, and mail birds (all at 9e4 and up) are not darkened, as before. Shapes and Graphics take no tint; under `NIGHT_TOP` there are only black shadows.
Why: the lit windows were once drawn above the tint at `TINT_DEPTH + 1`, and the tint at 8e4 above every character, so a window or lamp behind someone covered them after dark and only their legs showed (the operator's tech-office screenshot). Multiplying each sprite by the tint matches the old MULTIPLY rectangle exactly for normal and ADD blends, so by day nothing changes; a new sprite or re-tint must be caught before the frame is drawn, hence PRE_RENDER rather than `update`. Anything opaque or bright tied to a building or the floor must be depth-sorted like this; only airborne effects (motes, falling leaves, sky, fidget FX) stay above people.

Lamp brightness reaches the glow slots through the host's `lamps` callback (place-scene.ts `lamps` / `lampShare`), not through this module.

Coupled: apps/agent-world/src/theme-pack.ts, apps/agent-world/web/game/place-scene.ts, apps/agent-world/web/game/fidgets.ts, apps/agent-world/web/game/daylight.ts, apps/agent-world/themes/README.md
Verify: apps/agent-world/tests/world-atmosphere.test.ts, apps/agent-world/tests/atmosphere-pack.test.ts, apps/agent-world/tests/daylight.test.ts
