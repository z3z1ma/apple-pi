Status: in-progress
Created: 2026-10-03
Updated: 2026-10-03

# Glanceable panels for the Apple Pi TUI

## Intent

Stop every Apple Pi overlay from blocking typing and covering the transcript. Pinned glanceable panels (running subagents first) stay visible without taking focus; `/btw` becomes a top drop-down; modal overlays restore their selection and scroll position. Public Pi API only. Design direction and settled decisions: `.wiki/pages/tui-interaction-model.md`.

## Current State

Design is settled in the wiki page. `spec.md` holds the specification with confirmed test seams. Tickets are in `tickets/` (01 blocks 02; 01, 03, 04 can start now). Next: move to `ready`, then `/skill:implement`.

Prototype `prototype-glanceable-panel.ts` answered whether a non-capturing overlay can serve as a persistent panel without blocking the editor. Run it with `pi -e .ledger/202610030008-tui-glanceable-panels/prototype-glanceable-panel.ts`, then `/proto-pin`, `Alt+G` to focus, `Esc` to return, `/proto-modal`, `/proto-min <cols>`.

Verdict (tmux-driven run, 229 columns, Apple Pi editor loaded): the non-capturing panel stays mounted and live, the editor keeps input, focus moves in and out cleanly, a stacked modal closes without removing the panel, the panel survives a streaming turn, and `visible()` hides and restores it across a resize. A second run confirmed `Alt+G`, wheel scrolling over the panel, and click-to-focus in fullscreen.

## Outcome

Pending.
