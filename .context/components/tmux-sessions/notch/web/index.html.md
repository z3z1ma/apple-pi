## symbol:pointAt

In the notch panel, hover and drag both depend on the shell calling `window.notch.pointer(x, y)`. `track()` in `NotchShell.swift` calls it for `mouseMoved` and `leftMouseDragged`, from both the global and the local event monitor. Mousedown and mouseup reach the page natively.
Why: the panel never becomes key, so its WKWebView gets clicks but no mouse-move events. Without the forwarded `leftMouseDragged`, dragging works in a browser but not in the notch.
Coupled: components/tmux-sessions/notch/NotchShell.swift

## symbol:showTip

`draw()` refreshes the tooltip through `showTip()`, not `pointAt()`.
Why: during a drag `pointAt()` calls `moveDrag()`, which redraws. Calling it from `draw()` recursed until the stack overflowed.

## symbol:choices

The keys `vibes`, `rooms`, `looks` and `positions`, and how each is keyed, are the format of the `notch` preference in the session-state database. The shell stores the object as the page sends it.
Why: other front ends read the same preference. A renamed key also silently drops every saved choice, because the next load ignores the old key.
Coupled: docs/tmux-sessions.md, components/tmux-sessions/notch/NotchShell.swift
