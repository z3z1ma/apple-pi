# Plan: notch agent room as a real component

Carry prototype 2 (round 5) into apple-pi as a macOS view of the tmux agent records, next to the sidebar and dashboard. Behaviour stays as in the prototype. This plan adds start-up, single-instance, saved state, display changes, packaging and docs.

## Decisions (operator, 2026-10-16)

- Lives in apple-pi, under `components/tmux-sessions/`. It is another view of the same records and reuses `agents.py`.
- Starts when you use pi in tmux, one panel per Mac. The operator first chose "with the tmux plugin". Review showed the plugin reruns only when its stamp (file path plus modification time) changes: on a new tmux server, or an edit to the plugin file itself. So the tmux-sessions extension starts the panel instead, on every root pi session start inside tmux.
- Swift is compiled on first run and rebuilt when the source changes. Only source goes in git.
- Per-session choices (vibe, room, shuffle look, dragged positions) live in a JSON file in pi state, so a later web app or Tauri app can read them.
- Both vibes, every room (the game studio included) and all 7 workers carry over. The prototype's list view (`index.html`) does not.

## Layout

```
components/tmux-sessions/
  notch/NotchShell.swift      panel, web view, feed, focus, state file, single instance
  notch/web/index.html        the room page (prototype room.html)
  notch/web/assets/           generated PNGs and manifest.js (committed, published)
  notch/art/clean.py          asset pipeline (repository only)
  notch/art/raw/<vibe>/       generation sources (repository only)
  scripts/notch.sh            build on change, then start
  sidebar/agents.py           + `feed` mode: one JSON line per second from AgentStore
  src/index.ts                + run `notch.sh start` on each root pi session start inside tmux (macOS)
```

## Behaviour to add

1. **Feed.** `agents.py feed` prints the prototype's JSON lines, plus `tmuxSocket`, so focus targets the right server. The module stays stdlib-only. `feed.py` goes away.
2. **Start.** On Darwin, the extension queues `notch.sh start` after `ensurePlugin`, on each root pi session start inside tmux. Like the plugin load, a failure must not stop status publishing. The panel inherits pi's environment (`PI_CODING_AGENT_DIR`, `PI_TMUX_STATE_DIR`), so the feed reads the same state directory. The script hashes `NotchShell.swift` and builds `$PI_HOME/cache/notch/pi-notch-<hash>` with `swiftc -O` if that file is missing; it writes to a temporary file and renames it, so two servers starting at once do not clash. It then launches the binary detached. Without `swiftc` it logs one line and exits 0, so tmux shows nothing.
3. **One panel per Mac.** The shell takes a non-blocking `flock` on `$PI_HOME/state/notch.lock` and writes its pid and build hash there.
   - The lock is held by the same build: exit.
   - The lock is held by another build: send SIGTERM to the old pid, wait for the lock, and take over. That way a source change applies at the next root pi session start in tmux.
   - The kernel releases the lock when a panel crashes.
4. **Saved choices.** The shell injects `window.notchState` from `$PI_HOME/state/notch.json` at document start. The page posts `{type: "save", state}` after a change, and the shell writes it atomically (temporary file plus rename). localStorage is no longer used.
5. **Displays.** On `didChangeScreenParametersNotification`, the shell moves the panel to the screen with a notch, or to the top centre of the main screen when there is none. It then sends the new geometry to the page.
6. **Feed restarts.** If the feed process exits, the shell restarts it after one second.
7. **Focus.** The shell keeps calling `components/notify/scripts/focus-tmux.sh`, now with `TMUX_SOCKET` set from the agent. This is a cross-component coupling, recorded in a context file.

Out of scope: agents on tmux servers other than the default socket (the feed reads one server, as the sidebar does), the pixel-room progression ideas, and a web or Tauri app.

## Steps

1. `agents.py feed` and its pytest. Remove `feed.py`.
2. Move the page, assets and art pipeline into `notch/`. Replace localStorage with the state bridge, and add `window.notch.geometry()`.
3. Shell: arguments, single-instance lock, state file, display changes, feed restart, `TMUX_SOCKET`.
4. `notch.sh`, and the extension call in `src/index.ts` with its Vitest case (it runs `notch.sh start` on Darwin only).
5. Packaging and docs:
   - Add `notch/NotchShell.swift` and `notch/web/` to the published `files`, leaving out `notch/art/`.
   - Add a Notch section to `docs/tmux-sessions.md`: requirements (macOS, Xcode command line tools, uv), start-up, the state file, and how to add art with `generate_image` or `codex exec` plus `clean.py`.
   - Add a README catalog line and a line in the tmux-sessions row of AGENTS.md.
   - Move the two prototype context files to their new paths.
6. A Vitest check that runs `swiftc -typecheck` on `NotchShell.swift` on macOS when `swiftc` exists, and is skipped otherwise. The build happens on users' machines, so this catches a broken shell before release.

## Acceptance

1. On macOS with Xcode command line tools and uv, starting pi in tmux shows the notch pill with no extra setup.
2. A second tmux server does not start a second panel. After `NotchShell.swift` changes, the next root pi session start in tmux replaces the running panel with the new build.
3. The panel behaves as in prototype round 5: hover, pill, one room per session, cycling, vibe per session, 🎲, drag, and click to focus.
4. Choices survive a panel restart, and they are in `notch.json`.
5. Unplugging or connecting a display keeps the panel on the screen with the notch.
6. Without `swiftc`, or on Linux, nothing starts and tmux shows no error.
7. `npm run format:check`, `lint`, `typecheck` and `test` (including `test:sidebar`) pass. `pack:check` lists `notch/NotchShell.swift` and `notch/web/` and does not list `notch/art/`.

Not covered by automated tests: the page itself, because the repository has no browser test runner. Checks 1–5 are done by hand on the live panel, with a headless Chrome smoke test of the page during development.
