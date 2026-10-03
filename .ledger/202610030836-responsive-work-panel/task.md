Status: in-progress
Created: 2026-10-03
Updated: 2026-10-03

# Make the shared work panel the direct responsive control surface

## Intent

Replace the centered work picker with one responsive, non-capturing Agents/Tasks control panel. `/work` restores the last tab; `/agents` and `/tasks` select their tabs directly. See [design.md](design.md) for accepted behavior, terminology, and confirmed test seams.

## Current State

Implemented and committed on `main` as `78e81fe` (`feat(work): open one responsive agents and tasks panel directly`). Independent Standards and Intent reviews are complete.

- Review fixes preserve manual task scroll positions through resizing and keep short task views scrollable. Compact and full layouts share one viewport calculation; the resize test checks restored rendered content.
- Automated checks passed after those fixes and simplification: format, lint, typecheck, full `npm test` (1153 Vitest tests plus offline pair harness and loader), package dry run, and `git diff --check`.
- Fullscreen Pi checks demonstrated direct opening, wide/narrow placement, preserved editor and steering drafts, task inspection, focus return, and closing.
- End-to-end steering remains unverified: submitting a draft was observed, but an agent response to its unique marker was not. The task remains in-progress until this check and operator sign-off.

## Outcome

Pending final acceptance. Next:

1. In fullscreen Pi, open `/agents`, focus the panel, and send a steering message to a running agent asking it to echo a unique marker. Confirm the marker appears in the agent's response, not just in the submitted message, and record the result here.
2. Obtain operator acceptance after that check and explicit authority before closing this task. The implementation is already committed; task closure is not yet authorized.

The completed [glanceable-panel task](../history/202610030008-tui-glanceable-panels/task.md) remains unchanged as historical context.
