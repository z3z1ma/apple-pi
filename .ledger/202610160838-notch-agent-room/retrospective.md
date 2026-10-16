Status: done
Created: 2026-10-16
Updated: 2026-10-16

# Retrospective

## What Mattered

- Building on what existed. The tmux-sessions records and `AgentStore` already had every field the notch needed, and notify's focus script already handled focusing from outside tmux. The feature was a new view, not a new data path.
- A thin Swift shell hosting a web page. It proved native enough in the notch, and it keeps the renderer and assets reusable for a later web or Tauri app.
- Short prototype rounds with the operator. Each round changed the design: one room per session shown one at a time, office and cozy vibes, a shuffle that covers workers too, drag to place, and a room that grows with crowding but stays one size for every session.
- Two independent reviewers per ticket. Their real finds: a focus message that dropped the tmux socket, a panel inheriting pi's tmux server, a launch that ran once per process instead of per session, and lock takeover races.

## Learnings

- A non-activating panel that never becomes key gets clicks but no mouse-move events in its WKWebView. Hover and drag need the shell to forward the pointer.
- Generated pixel art becomes usable with cleanup:
  - For rooms, ask for a backdrop and crop the largest rectangle inside the room.
  - For workers, use a 2×2 pose sheet on magenta, a hue-band key, a blue shirt to recolour, and a fixed cell size so generators with different resolutions match.
- `codex exec` with its built-in image tool is a working fallback when the Antigravity image quota runs out.
- A file lock for a single instance needs close-on-exec, and racing starts must not block on it. Builds identified only by hash cannot be ordered, so one rare race is left; the operator accepted it.
- A pi extension that starts a long-lived helper must strip `TMUX`/`TMUX_PANE`, or the helper silently binds to the launching pi's tmux server.

## Improvements

- Full `npm test` under machine load 12–19 timed out a different set of unrelated tests in each run. A load-aware run, or a larger test timeout for the heavy suites, would give a reliable signal while other agents run.
- The page has no automated test seam, because the repository has no browser runner. Headless Chrome with a stub shell caught real bugs in this task; a small Playwright check would keep that coverage.
