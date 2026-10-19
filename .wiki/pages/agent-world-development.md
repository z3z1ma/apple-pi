# Agent World development

Hazards found while building Agent World (`apps/agent-world/`, ledger task `202610171741-guildworld`) that its code and tests do not show. The user contract is `docs/agent-world.md`; build, test, and art commands are in `docs/development.md`. Vocabulary is in [[agent-world-language]].

## Headless UI tests

- The headless-Chrome tests load the committed `dist/`, not the sources: run `npm run build:world` first. With several lanes editing sources, a stale-dist failure in `build.test.ts` is a race, not a bug. `AGENT_WORLD_SHOTS=<dir>` saves screenshots.
- CSS animations never advance in this headless Chrome; take screenshots with `animations: "disabled"`. Playwright's web-first matchers (`expect(locator).toBeVisible()`) fail under Vitest's `expect`; use `locator.waitFor` and `vi.waitFor` (see `tests/world-square.test.ts`).
- The interface panels cover parts of the world. A test that clicks world points injects `.aw-interface, .aw-interface * { pointer-events: none !important; }`. After a place panel has opened and closed, `locator.click()` on side-panel buttons can hang; `dispatchEvent("click")` works.
- Talk to opens the conversation panel's veil: fixtures need `conversation` and `markSeen` stubs, and a test presses Escape before clicking on. Clicking the side-panel tab that is already open folds the panel. Places rows are found by the exact title `Travel to <name>`.
- Characters who join a place walk in from its `enterBy` door; wait until no figure is `moving` before reading positions.
- To prove a play sends nothing, bridge the built UI to the real backend with `page.exposeFunction` and compare the runtime's `commands`, `events`, and `preferences` rows (`tests/fidgets.test.ts`); a `themes` reply that is not an array crashes the UI.
- Recordings: Playwright video needs ffmpeg, which is absent; loop JPEG screenshots into a GIF with Pillow.

## World and interface code

- Phaser 4 replays a frame's key queue on each new key event, so a toggle bound to `keydown-X` can fire twice; guard it with a set of handled events (`PlaceScene.toggleGrid`). In a scene's shutdown handler the images are gone: only stop timers and tweens.
- A window capture-phase `stopImmediatePropagation` also stops React's key handlers; stop keys in a bubble-phase listener on `document`. In skins, `.aw-interface button { font: inherit }` beats single-class rules; use `:where(.aw-interface) button`. Pack `url()` tokens set on the root must be made absolute.
- Every panel store registers with `web/overlay/one-panel.ts`, and outside-write confirmations dismiss through `dialogLayer` in `place-dialog.tsx`; a new place panel does both.
- Biome rejects `role="radio"` on a button; use real radio inputs in a fieldset and click their labels in tests.
- Agent World's Electron types come from a local shim (`src/electron/electron.d.ts`); pass the objects you have rather than adding API surface.

## Place data and art

- Trace walk grids on a world-size render with a labelled half-tile grid. Find occlusion defects by walking the avatar just north of every blocked rect; a foreground piece's bottom edge is its `feet` line, so a sloping rail is several stepped pieces.
- Overlay sprites have wide transparent margins and decorated borders: measure the usable area with Pillow before sizing text to one (the banner's cloth is about half its width).
- A painted repeating section (the gallery) drifts a few pixels per repeat: find the period by a column-difference scan and cut where both the wall band and the full height match.
- A fountain traced as one foreground piece hides the water overlay unless water is drawn just above the piece.
- Codex art: say "draw no desk" for seated frames, and scale each sheet row on its own. Raw art stays local (about 140 MB for three themes); cleaned art ships.

## Performance and runtime

- A transcript can exceed V8's longest string (a 390 MB session); the runtime streams JSONL line by line. Measurements and the profiling harness (`performance.eventLoopUtilization`, `node:inspector` profiles) are in the task's `research/ticket-30-measurements/`.
- World updates leave out unchanged sleepers and mail (`unchanged: ["dormant", "mail"]`); fixtures that push whole snapshots still work.
- Testing the runtime: count transcript reads by serving the session file as a FIFO; faux sessions emit a reply's deltas in one burst, so test back-pressure with separate `reply_delta` lines from `fakeBridge`.
