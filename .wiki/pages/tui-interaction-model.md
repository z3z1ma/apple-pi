# TUI interaction model

Status: in design. Not yet a product contract; `docs/` will own it once settled. Execution and the prototype live in `.ledger/202610030008-tui-glanceable-panels/`.

A **glanceable panel** is an overlay that stays visible without taking keyboard focus, so the editor keeps input. A **modal overlay** takes focus until it closes.

## Open decisions

None. The implementation specification is `spec.md` in the ledger task.

## Problem

Every Apple Pi overlay (agent viewer, `/btw`, `/work`, task viewer) is a centered modal that takes keyboard focus. The operator named two problems:

- An open overlay blocks typing to the main agent.
- An overlay covers the transcript.

## Settled decisions

- **Scope:** the interaction model for all Apple Pi overlays and panels, not one new panel.
- **Platform limit:** public Pi API only. Overlays draw over the transcript; nothing reflows it into columns. Patching Pi internals and proposing an upstream layout API are out for now; upstream stays the option if the public API proves too limiting.
- **First glanceable content:** running subagents' live output.
- **In scope from Duggan's article (see Source):** glanceable panels that do not take focus; layout that adapts to terminal width; a quake-style top drop-down for `/btw`; overlays that reopen with their selection and scroll position.
- **Out of scope:** grouping views by task, and hiding private content during screen sharing.
- **Overlay roles:** the agent viewer becomes the glanceable subagent panel. `/btw` becomes a top drop-down that takes focus while you type, closes on Esc, and keeps its answer in the `/btw` session. `/work` and the task viewer stay modal and gain restored selection and scroll position. Prompt stash is unchanged: its only overlay is a placeholder while `$EDITOR` runs, so it has nothing to restore. `ask_user_question` stays modal and unchanged, because each questionnaire is new.
- **Opening:** the operator pins the subagent panel from `/work`; it never opens by itself.
- **Unpinning:** `q` while the panel has focus, or an unpin action on the agent in `/work`.
- **Panel actions:** with focus, the panel keeps the agent viewer's actions and keys: Enter steers the selected agent, `x` twice aborts it. Esc now returns focus instead of closing; `q` unpins.
- **Idle panel:** with no agent running, the panel stays pinned and shows finished agents until unpinned.
- **Focus:** `Alt+G` moves focus between the editor and the panel; Esc in the panel returns it to the editor. The operator uses `Alt+O` elsewhere; Pi's defaults and Apple Pi do not bind `Alt+G`.
- **Restored state:** in memory for the Pi process only, never in the session file.
- **Placement:** top right, one third of the terminal width, up to 70% of its height.
- **Several agents:** one panel with a compact list of the session's agents, running and finished, and the selected agent's live output below it.
- **Narrow terminals:** the panel hides below 120 terminal columns, where it would be about 40 columns wide, and the one-line active-work status remains. It returns when the terminal widens.
- **Mouse (fullscreen):** a left click focuses the panel; the wheel scrolls it. Every action also has a keyboard path.
- **Covered transcript:** accepted. Long lines under the panel stay hidden; unpin the panel or narrow the terminal to read them. No temporary-hide key.

## Platform facts

Checked against Pi's interactive mode and `pi-tui`:

- `OverlayOptions` supports `nonCapturing`, edge `anchor` with offsets, `width`/`minWidth`/`maxHeight`, and `visible(termWidth, termHeight)`. `OverlayHandle` supports `focus()`, `unfocus()`, `setHidden()`, and `hide()`.
- Closing a `ctx.ui.custom()` overlay calls `hideOverlay()`, which removes the topmost overlay, not necessarily its own. A persistent panel must be mounted with `tui.showOverlay` and hide through its own handle. `components/shared/src/active-work.ts` already holds a `tui` reference from its widget factory.
- The operator runs `tuiMode: fullscreen`, so mouse regions and wheel scrolling are available.
- Subagent sessions and the `/btw` conversation outlive their viewers. `/work` forgets its selection each time it closes; scroll and selection of other overlays are unchecked.

Proven by a throwaway prototype in a real fullscreen Pi with the Apple Pi editor (2026-10-03):

- A `nonCapturing` overlay stays mounted and updates live while the editor keeps input.
- `focus()` moves keys into the panel; `unfocus()` on Esc returns them to the editor with its text intact.
- A capturing `ctx.ui.custom()` modal opened above the panel closes on Esc without removing the panel.
- The panel renders through a streaming agent turn.
- `visible(termWidth)` hides the panel when the terminal narrows and restores it when it widens.
- In fullscreen, a wheel event over the panel reaches its `handleMouse`, and a left press that returns `{ focus: true }` focuses it; Esc returns focus to the editor.

Not measured: how much of a long assistant line the panel hides in daily use (accepted as a trade-off).

## Source

Mat Duggan, "Make tmux the OS" (https://matduggan.com/what-does-my-dream-os-ui-look-like/): focal work versus glanceables, a fixed contract for display changes, append-don't-replace for spatial memory, and the quake overlay.
