# Agent World development

Hazards found while building Agent World (`apps/agent-world/`, ledger task `202610171741-guildworld`) that its code and tests do not show. The user contract is `docs/agent-world.md`; build, test, and art commands are in `docs/development.md`. Vocabulary is in [[agent-world-language]].

## Headless UI tests

- The headless-Chrome tests load the committed `dist/`, not the sources: run `npm run build:world` first. With several lanes editing sources, a stale-dist failure in `build.test.ts` is a race, not a bug. `AGENT_WORLD_SHOTS=<dir>` saves screenshots.
- CSS animations never advance in this headless Chrome; take screenshots with `animations: "disabled"`. Playwright's web-first matchers (`expect(locator).toBeVisible()`) fail under Vitest's `expect`; use `locator.waitFor` and `vi.waitFor` (see `tests/world-square.test.ts`).
- The interface panels cover parts of the world. A test that clicks world points injects `.aw-interface, .aw-interface * { pointer-events: none !important; }`. After a place panel has opened and closed, `locator.click()` on side-panel buttons can hang; `dispatchEvent("click")` works.
- Talk to opens the conversation panel's veil: fixtures need `conversation` and `markSeen` stubs, and a test presses Escape before clicking on. Clicking the side-panel tab that is already open folds the panel. Places rows are found by the exact title `Travel to <name>`.
- Characters who join a place walk in from its `enterBy` door; wait until no figure is `moving` before reading positions.
- Life (idles, wandering) is still under headless Chrome (`navigator.webdriver`) so positions and frames stay exact; a test of life sets `window.agentWorldLife = { pace }` in its init script (`tests/world-life.test.ts`). Page CSP forbids string evaluation, so Python Playwright's `wait_for_function` fails; poll with `page.evaluate`.
- To prove a play sends nothing, bridge the built UI to the real backend with `page.exposeFunction` and compare the runtime's `commands`, `events`, and `preferences` rows (`tests/fidgets.test.ts`); a `themes` reply that is not an array crashes the UI.
- Recordings: Playwright video needs ffmpeg, which is absent; loop JPEG screenshots into a GIF with Pillow.

## World and interface code

- Phaser 4 replays a frame's key queue on each new key event, so a toggle bound to `keydown-X` can fire twice; guard it with a set of handled events (`PlaceScene.toggleGrid`). In a scene's shutdown handler the images are gone: only stop timers and tweens.
- A window capture-phase `stopImmediatePropagation` also stops React's key handlers; stop keys in a bubble-phase listener on `document`. In skins, `.aw-interface button { font: inherit }` beats single-class rules; use `:where(.aw-interface) button`. Pack `url()` tokens set on the root must be made absolute.
- Every panel store registers with `web/overlay/one-panel.ts`, and outside-write confirmations dismiss through `dialogLayer` in `place-dialog.tsx`; a new place panel does both.
- Biome rejects `role="radio"` on a button; use real radio inputs in a fieldset and click their labels in tests.
- Agent World's Electron types come from a local shim (`src/electron/electron.d.ts`); pass the objects you have rather than adding API surface.

## macOS Electron process and window diagnostics

For a window-state probe, first select the verified process in System Events: `set targetProcess to first application process whose unix id is <pid>`. Then query that object with `count of windows of targetProcess` or its window attributes. The combined query `get {name, unix id, count of windows} of every application process whose ...` failed with AppleScript error -1728 and expanded unrelated process properties; the two-step query worked.

Keep process identity and window state separate. A surviving PID does not establish an open window. A successful window query records that moment, not what the operator saw earlier or why an earlier Quit was cancelled. Use a freshly verified PID rather than a historical activation record.

After a launch check times out, inspect the same newly launched process: verify its exact executable/arguments and incarnation, query its window, and establish its Unix-socket connection to the expected daemon. Treat the deadline as an observation limit and preserve an independently verified healthy instance. During build70 activation, the initial connection check expired but fresh process/window/socket evidence established that the same app was connected; the cause of the delayed verification remains unproven.

Sources: Workplace relaunch investigations, session learnings `87f3b9a0245f` and `2126124b88bf`, distilled 2026-10-30. The successful probes were observed in those investigations; they were not rerun during this synthesis.

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

## Aliveness work (2026-10-19)

- **Cursor screenshots:** headless screenshots never include the CSS cursor; draw its data URL as an image at the pointer minus the hotspot (`tests/world-pointer.test.ts` `shot`). Chrome serialises an `image-set` cursor with the hotspot at the end of the string. Python Playwright's `wait_for_function` fails under the world's CSP; poll with `page.evaluate`.
- **Time in tests:** `page.clock.setFixedTime` freezes Phaser tweens (they measure with `Date.now()`); use `setSystemTime` with a UTC `timezoneId`.
- **Wait for the world:** the side panel draws before `main.tsx` finishes loading the theme; wait for `agentWorldView.place()` before clicking Talk to, or the intent is lost.
- **A theme that will not load** in a headless test usually means a pack fails the pack check (often another lane mid-change); read the `.notice-lasting` text and run `check-theme.ts` first.
- **Identity drift:** generated idle sheets passed the pack check but drew different people until the look's own sheet was attached as a reference image; compare standing frame and new frames on one contact sheet.
- **Depth:** a rectangular foreground piece over a table or tree draws floor over the legs of anyone behind it; cut it into narrow column strips that follow the painted top edge, and push furniture footprints north until about a third of a figure behind shows.
- **Fidget walk-up:** `standPoints` treats every blocked rect under a fidget as one piece, so a fidget on the edge of a big rect needs its own small rect; small pets need a stand point beside them, not in front, or the avatar hides them. Run `world-fidgets` after any fidget move.
- **Pet looks** keep their own frame order (sit, petted, play, sleep); a look must not inherit the kind's `frames`.
- **Forms on `.aw-letter`:** give the grid `minmax(0, 1fr)` columns and rows `min-width: 0`, or a select's longest option pushes fields off the dialog. The runtime's `rename` renames the Pi session, not the tmux window.
- **Exteriors:** trace a new exterior at its square's pixels per tile (painting width / cols), so figures keep their size between places.
- **Pack-check messages** print numbers normalised (`41`, not `41.0`); grep the place file before a text replace keyed on a message.
- **Biome complexity:** `checkPlace` in `src/theme-pack.ts` and the gate's `describe` switch are near the limit; add a helper instead of another inline branch.
- **Hover text** counts Walk here among the options ("Talk to X / 2 more options").
- **Dark band at a painting's edge** in walkthrough shots is `followMid` sliding the painting out from under the interface, not a missing clamp.
- **Cost:** atmosphere effects cost about 0.01 to 0.02 ms per frame; with 120 characters in the square frames average about 20 ms with or without effects, so frame time there comes from characters. `test:world` runs with a 30 s hook timeout because Chrome start-up under heavy load passed 10 s.
