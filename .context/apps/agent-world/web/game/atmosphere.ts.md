## file

Effects move only at `lifePace()`, which is 0 under webdriver unless the page sets `window.agentWorldLife`. Every effect must still be drawn the moment a place opens: falling particles start part-way through their life so `shown` is never empty.
Why: headless screenshots and tests run with life still. An effect that only appears once it moves is invisible there, and world-atmosphere.test.ts fails on `shown` being 0.

Daylight tests move the page clock with `page.clock.setSystemTime`, never `setFixedTime`.
Why: Phaser's tweens measure time with `Date.now()`. A fixed clock freezes the glow flicker and lamp fades that the night check reads, so night glows look no brighter than day.

Out of doors the tint is one MULTIPLY rectangle at `TINT_DEPTH` over everything. The lit windows and halos (cut from the painting's bright, warm pixels inside the `lights` rects) sit at `TINT_DEPTH + 1` and `+ 2`.
Why: drawn under the tint, the night would darken the lit windows along with the rest of the painting.

Lamp brightness reaches the glow slots through the host's `lamps` callback (place-scene.ts `lamps` / `lampShare`), not through this module.

Coupled: apps/agent-world/src/theme-pack.ts, apps/agent-world/web/game/place-scene.ts, apps/agent-world/web/game/daylight.ts, apps/agent-world/themes/README.md
Verify: apps/agent-world/tests/world-atmosphere.test.ts, apps/agent-world/tests/atmosphere-pack.test.ts, apps/agent-world/tests/daylight.test.ts
