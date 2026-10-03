Status: done
Created: 2026-10-03
Updated: 2026-10-03

# Retrospective

## What Mattered

- A throwaway prototype driven through tmux proved the overlay API (non-capturing panel, focus, stacked modals, resize) before any spec, so the design never rested on guesses.
- Two independent reviewers (standards and intent) found eight real defects the builders' tests missed: cursor focus, hidden composer, stale activity, frozen streaming, armed abort, retention, `/btw` height, and missing real-terminal evidence.

## Learnings

- Map a source to the layer it actually discusses. A desktop-UI article was first read as advice on agent architecture (sandboxing, ledger cleanup); the operator meant the TUI.
- Open each component's real UI before citing it as a design premise. Prompt stash was listed as a browsable overlay from a grep for `ctx.ui.custom`; it is only a placeholder while `$EDITOR` runs, which changed settled scope late.
- Before changing a shared policy (agent retention) to satisfy one view's lifetime, spell out its effects on the other consumers (results, resume, session boundaries).
- `wiki_lint` can fail with "changed while scanning" when run during a wiki write; rerun it once writes stop.

## Improvements

- `ctx.ui.custom()` closes the topmost overlay, not its own; any persistent panel must use `tui.showOverlay` with its own handle.
- Changing a retention rule needs a session-boundary test: the first retention fix let unread results carried into a new session live forever.
