## symbol:Book

While open, a capture-phase `keydown` listener on `window` stops every key (`stopImmediatePropagation`) and closes on Escape; `keyup` is left alone.
Why: Phaser's keyboard plugin listens on `window` and would walk the avatar or toggle the walk grid while the operator reads; letting key releases through keeps a key held at opening from staying down in Phaser after the panel closes.
Coupled: apps/agent-world/web/game/place-scene.ts
Verify: apps/agent-world/tests/world-conversation.test.ts

`mark_seen` is sent when the panel opens on a character with `needsYouSince`, and again on a later settle only while the window has focus.
Why: opening is seeing (decision 17); a panel left open in a background window must not swallow "finished" for every other view.
Verify: apps/agent-world/tests/world-conversation.test.ts

The happy portrait stays while the conversation is open after seeing clears `unseen`, until the character works or asks again.
Why: marking seen on open would flip the face to neutral within a second of opening.

## symbol:Transcript

Older pages keep the view still by adding the growth of `scrollHeight` to `scrollTop` in a layout effect, with `overflow-anchor: none`, and the "Turning back the pages" label sits outside the scrolling log.
Why: Chrome's own scroll anchoring does not act at `scrollTop` 0, and anything inserted above the entries while a page loads moves them without a first-entry change the effect can see.
Coupled: apps/agent-world/web/overlay/conversation/conversation.css, apps/agent-world/web/overlay/conversation/history.ts
Verify: apps/agent-world/tests/world-conversation.test.ts
