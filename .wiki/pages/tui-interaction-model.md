# TUI interaction model

Status: settled and built. The product contracts are the work panel in `docs/tasks.md` (section "Work panel") and the `/btw` overlay in `docs/btw.md`. The design record lives in `.ledger/history/202610030008-tui-glanceable-panels/`.

A **glanceable panel** is an overlay that stays visible without taking keyboard focus, so the editor keeps input. A **modal overlay** takes focus until it closes.

## Problem

A centered modal overlay takes keyboard focus. The operator named two problems:

- An open overlay blocks typing to the main agent.
- An overlay covers the transcript.

## The model

- **Scope:** the interaction model for all Apple Pi overlays and panels, not one panel.
- **Platform limit:** public Pi API only. Overlays draw over the transcript; nothing reflows it into columns. Patching Pi internals and proposing an upstream layout API are out for now; upstream stays the option if the public API proves too limiting.
- **From Duggan's article (see Source):** glanceable panels that do not take focus; layout that adapts to terminal width; a quake-style top drop-down for `/btw`; overlays that reopen with their selection and scroll position.
- **Out of scope:** grouping views by task, and hiding private content during screen sharing.
- **Overlay roles:** the work panel is the glanceable panel, with a Tasks tab and a Pi Exec tab. `/btw` is a top-center drop-down, half the terminal height, that takes focus while you type, closes on Esc, and keeps its answer in the `/btw` session. Prompt stash has only a placeholder overlay while `$EDITOR` runs, so it has nothing to restore. `ask_user_question` stays modal, because each questionnaire is new.
- **Opening:** `/work`, `/tasks`, or `Ctrl+W` opens the work panel; it never opens by itself. `q` with focus or `Ctrl+W` closes it.
- **Focus:** `Alt+G` moves focus between the editor and the panel; Esc in the panel returns it to the editor. The operator uses `Alt+O` elsewhere; Pi's defaults and Apple Pi do not bind `Alt+G`.
- **Idle panel:** with no work running, the panel stays open and shows settled records until closed.
- **Restored state:** the tab, each tab's selection, and scroll position live in memory for the Pi process only, never in the session file.
- **Placement:** at 120 columns or more, top right, one third of the terminal width, up to 70% of its height. On narrower terminals, a top-center drop-down like `/btw`, 90% of the width and up to half the height. Resizing keeps the same panel and its state.
- **Mouse (fullscreen):** a left click focuses the panel and selects a tab; the wheel scrolls it. Every action also has a keyboard path.
- **Covered transcript:** accepted. Long lines under the panel stay hidden; close the panel to read them. No temporary-hide key.

## Platform facts

Checked against Pi's interactive mode and `pi-tui`:

- `OverlayOptions` supports `nonCapturing`, edge `anchor` with offsets, `width`/`minWidth`/`maxHeight`, and `visible(termWidth, termHeight)`. `OverlayHandle` supports `focus()`, `unfocus()`, `setHidden()`, and `hide()`.
- Closing a `ctx.ui.custom()` overlay calls `hideOverlay()`, which removes the topmost overlay, not necessarily its own. A persistent panel must be mounted with `tui.showOverlay` and hide through its own handle, as `components/shared/src/work-manager.ts` does.
- pi-tui resolves an overlay's options on every render, so getter-based placement follows the terminal width without remounting the panel.
- The operator runs `tuiMode: fullscreen`, so mouse regions and wheel scrolling are available.
- The `/btw` conversation outlives its overlay.

Proven by a throwaway prototype in a real fullscreen Pi with the Apple Pi editor:

- A `nonCapturing` overlay stays mounted and updates live while the editor keeps input.
- `focus()` moves keys into the panel; `unfocus()` on Esc returns them to the editor with its text intact.
- A capturing `ctx.ui.custom()` modal opened above the panel closes on Esc without removing the panel.
- The panel renders through a streaming agent turn.
- In fullscreen, a wheel event over the panel reaches its `handleMouse`, and a left press that returns `{ focus: true }` focuses it; Esc returns focus to the editor.

Not measured: how much of a long assistant line the panel hides in daily use (accepted as a trade-off).

## Source

Mat Duggan, "Make tmux the OS" (https://matduggan.com/what-does-my-dream-os-ui-look-like/): focal work versus glanceables, a fixed contract for display changes, append-don't-replace for spatial memory, and the quake overlay.
