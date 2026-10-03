Status: done
Created: 2026-10-03
Updated: 2026-10-03

# Glanceable panels for the Apple Pi TUI

## Intent

Stop every Apple Pi overlay from blocking typing and covering the transcript. Pinned glanceable panels (running subagents first) stay visible without taking focus; `/btw` becomes a top drop-down; modal overlays restore their selection and scroll position. Public Pi API only. Design direction and settled decisions: `.wiki/pages/tui-interaction-model.md`.

## Current State

Design is settled in the wiki page; `spec.md` holds the specification. All four tickets are implemented and committed, each with unit seams; tickets 01 and 02 were also checked in a real fullscreen Pi through tmux. Implementation decisions taken with the operator: finished public agents stay until session end; `/btw` drops down at half the terminal height. The operator signed off; all tickets are done.

Prototype `prototype-glanceable-panel.ts` answered whether a non-capturing overlay can serve as a persistent panel without blocking the editor. Run it with `pi -e .ledger/202610030008-tui-glanceable-panels/prototype-glanceable-panel.ts`, then `/proto-pin`, `Alt+G` to focus, `Esc` to return, `/proto-modal`, `/proto-min <cols>`.

Verdict (tmux-driven run, 229 columns, Apple Pi editor loaded): the non-capturing panel stays mounted and live, the editor keeps input, focus moves in and out cleanly, a stacked modal closes without removing the panel, the panel survives a streaming turn, and `visible()` hides and restores it across a resize. A second run confirmed `Alt+G`, wheel scrolling over the panel, and click-to-focus in fullscreen.

## Outcome

Shipped on `main`: a pinned, non-capturing agent panel (pin from `/work`, `Alt+G` focus, `Esc` back, Enter steer, `x x` stop, `q` or `/work` `u` to unpin, mouse click and wheel, hidden below 120 columns); `/btw` as a top-center drop-down at half height; `/work` and task detail reopen where left (memory only). Finished public agents now stay until session end. Product contract: `docs/subagents.md`, `docs/btw.md`, `docs/tasks.md`.
