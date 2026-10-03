# Specification: glanceable panels for the Apple Pi TUI

## Problem Statement

Every Apple Pi overlay is a centered modal that takes keyboard focus. While the operator watches a subagent, reads a `/btw` answer, or browses `/work`, they cannot type to the main agent, and the overlay covers the transcript. To check on a running subagent, the operator must open a modal, read, close it, and lose their place. Modals also forget their selection each time they close.

## Solution

Apple Pi gains one glanceable panel: a subagent panel that the operator pins from `/work`. It stays visible at the top right without taking focus, so the editor keeps input while subagents run. The operator moves focus into the panel with `Alt+G` or a click to steer, abort, scroll, or unpin, and `Esc` returns focus to the editor. The panel hides on narrow terminals and returns when the terminal widens. `/btw` drops down from the top instead of opening in the center. `/work` and the task viewer reopen with their last selection and scroll position for the life of the Pi process.

Everything stays within the public Pi API. The panel draws over the transcript; it does not reflow it.

## User Stories

1. As an operator, I want to pin a subagent panel from `/work`, so that I can watch subagents without a modal.
2. As an operator, I want the panel to never open by itself, so that the screen does not change while I think.
3. As an operator, I want the pinned panel to leave keyboard focus in the editor, so that I keep typing to the main agent.
4. As an operator, I want the panel at the top right, one third of the terminal width and at most 70% of its height, so that the editor and the newest transcript lines stay visible.
5. As an operator, I want the panel to list every agent of the session, running and finished, so that I see all agent states at a glance.
6. As an operator, I want the selected agent's live output below the list, so that I can follow its progress without opening anything.
7. As an operator, I want the output to update while the agent works, so that the panel is always current.
8. As an operator, I want to select a different agent in the panel, so that I can follow another one.
9. As an operator, I want `Alt+G` to move focus into the panel, so that I can act on it from the keyboard.
10. As an operator, I want `Alt+G` again or `Esc` in the panel to return focus to the editor, so that I go back to typing with my draft intact.
11. As an operator in fullscreen mode, I want a left click on the panel to focus it, so that I can use the mouse.
12. As an operator in fullscreen mode, I want the mouse wheel over the panel to scroll it, so that I can read earlier output.
13. As an operator, I want keyboard scrolling in the focused panel, so that every mouse action has a keyboard path.
14. As an operator, I want Enter in the focused panel to steer the selected agent, as in today's agent viewer, so that I keep that ability.
15. As an operator, I want `x` pressed twice in the focused panel to abort the selected agent, as in today's agent viewer, so that I keep that ability with the same confirmation.
16. As an operator, I want `q` in the focused panel to unpin it, so that I can close it quickly.
17. As an operator, I want an unpin action on the agent in `/work`, so that I can unpin without focusing the panel.
18. As an operator, I want the panel to stay pinned when no agent is running and to keep showing finished agents, so that it never moves on its own.
19. As an operator on a terminal narrower than 120 columns, I want the panel to hide and the one-line active-work status to remain, so that a narrow screen stays usable.
20. As an operator, I want the hidden panel to return in the same state when the terminal widens again, so that undocking a laptop or splitting tmux costs nothing.
21. As an operator, I want a modal such as `/work` opened over the pinned panel to close without removing the panel, so that modals and the panel coexist.
22. As an operator, I want the panel to keep rendering through main-agent turns, so that it stays reliable while I work.
23. As an operator, I want `/btw` to drop down from the top of the screen, so that a side question feels quick and stays out of the transcript's center.
24. As an operator, I want the `/btw` drop-down to take focus while I type and close on `Esc`, so that it behaves like a quick input.
25. As an operator, I want the `/btw` answer to remain in the `/btw` session after it closes, as today, so that I lose nothing.
26. As an operator, I want `/work` to reopen with the tab and selection I last used, so that I keep my place.
27. As an operator, I want the task viewer to reopen a task with its last scroll position, so that I keep my place in long output.
28. As an operator, I want restored selection and scroll position to last only for the Pi process, so that UI state never enters the session file.
29. As an operator, I want a restarted Pi to start with no restored UI state, so that stale positions never come back.
30. As an operator, I want `ask_user_question` to stay unchanged, so that each new questionnaire starts fresh.
31. As an operator who uses `Alt+O` elsewhere, I want the panel's focus key to be `Alt+G`, so that it does not collide with my other tools.

## Implementation Decisions

- **Panel ownership.** The subagents component owns the subagent panel and replaces the modal agent conversation viewer. The panel reuses the conversation viewer's rendering, live session subscription, steering input, and two-press abort. Esc in the panel returns focus instead of closing; `q` unpins.
- **Mounting.** The panel mounts with `tui.showOverlay` and keeps its own `OverlayHandle`, which it alone hides on unpin or session shutdown. It never mounts through `ctx.ui.custom()`, because closing a `custom()` overlay removes the topmost overlay, which may be the panel. The `TUI` reference comes from a Pi UI factory, as the shared active-work renderer already obtains it.
- **Overlay options.** Shape proven by the prototype, trimmed to the decision:

  ```ts
  {
  	nonCapturing: true,
  	anchor: "top-right",
  	width: "33%",
  	maxHeight: "70%",
  	visible: (termWidth) => termWidth >= 120,
  }
  ```

- **Focus.** `Alt+G` is registered as an Apple Pi shortcut and toggles `handle.focus()` / `handle.unfocus()`. A left mouse press on the panel returns `{ focus: true }`; a wheel event scrolls it.
- **Pinning and unpinning.** In the work manager's Agents section, the inspect action pins the panel (when not pinned) and selects that agent in it. The Agents section offers an unpin action while the panel is pinned. Its key follows the section's existing configured keybindings and is chosen at implementation.
- **Agent list.** The panel lists the session's public agents, running and finished, and shows the selected agent's live output below the list.
- **Narrow terminals.** Below 120 terminal columns the panel's `visible` callback hides it; the shared active-work status line stays as it is today.
- **`/btw`.** The `/btw` overlay anchors at the top center with a short fixed height. It keeps capturing focus, closes on `Esc`, and keeps its session behavior.
- **Restored state.** The work manager keeps the active tab and per-section selection for the process lifetime instead of per opening. The task viewer keeps scroll position per task for the process lifetime. Restored state lives in memory only and never calls session persistence.
- **Unchanged.** `ask_user_question` and the prompt stash. Prompt stash has no browsable overlay: its only overlay is a placeholder while `$EDITOR` runs, so it has no selection or scroll to restore.
- **Documentation.** `docs/subagents.md`, `docs/btw.md`, and `docs/tasks.md` describe the new panel, keys, `/btw` placement, and restored state. The README catalog changes only if the public surface summary changes.

## Testing Decisions

- Good tests assert observable behavior through public surfaces: commands, shortcut handlers, overlay options passed to the fake `tui`, component `render(width)`, `handleInput`, and `handleMouse`. They never assert private fields.
- **Seam 1, extension seam (automated, confirmed).** Install the work manager, subagents (including `/btw`), and tasks into a fake `pi` and fake `ctx.ui`, with a fake `tui` whose `showOverlay` records options and returns a fake handle. Cover:
  - pinning only on request, non-capturing, with the agreed placement options;
  - one list of running and finished agents with live output;
  - `Alt+G` and a click focus the panel; `Esc` returns focus;
  - Enter steers, `x` twice aborts, `q` unpins; unpin from `/work`;
  - wheel scrolling; hidden below 120 columns and restored above;
  - a modal closed above the panel leaves the panel mounted;
  - `/btw` opens anchored at the top;
  - `/work` and the task viewer reopen with their last selection and scroll;
  - a freshly installed extension (a restart) starts with no restored state, and restoring never calls `pi.appendEntry` or other session persistence.
- **Seam 2, real-terminal check (manual, confirmed).** Repeat the prototype procedure in a real fullscreen Pi through tmux: focus routing, mouse input, a modal stacked above the panel, `q` unpin, and Enter steer from the panel.
- **Prior art:** `tests/work-manager.test.ts`, the `/agents` overlay test in `components/subagents/tests/subagents.test.ts`, `components/subagents/tests/subagent-conversation-viewer.test.ts` for steer and abort, `components/subagents/tests/subagent-btw-command.test.ts`, and `components/tasks/tests/task-manager.test.ts`.
- **Excluded from the seam:** prompt stash and `ask_user_question`, because neither changes (see Implementation Decisions).

## Out of Scope

- Grouping views by task.
- Hiding private content during screen sharing.
- Patching Pi internals or reflowing the transcript; proposing an upstream Pi layout API (the fallback if the public API proves too limiting).
- A key that temporarily hides the panel without unpinning it.
- Opening the panel automatically.
- Persisting UI state in the session file.
- Changes to `ask_user_question` and prompt stash.
- Other glanceable content (tasks, pair notes, `/btw` answers, ledger task) beyond subagents.

## Further Notes

- Design direction, settled decisions, and platform facts: `.wiki/pages/tui-interaction-model.md`.
- Prototype and its run procedure: `prototype-glanceable-panel.ts` in this task bundle; verdict in `task.md`.
- Source idea: Mat Duggan, "Make tmux the OS" (https://matduggan.com/what-does-my-dream-os-ui-look-like/).
- Pi overlay API: Pi `docs/tui.md` ("Use custom screens and overlays") and `pi-tui` `OverlayOptions` / `OverlayHandle`.
