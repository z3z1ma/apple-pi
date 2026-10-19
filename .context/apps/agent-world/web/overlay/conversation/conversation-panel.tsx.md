## symbol:Panel

While open, a capture-phase `keydown` listener on `window` stops every key aimed outside the panel and turns Escape into `conversationPanel.escape()` (a confirmation first, then the panel); keys aimed inside the panel go on to its fields and React handlers, and a bubble-phase listener on `document` stops them there. `keyup` is left alone.
Why: Phaser's keyboard plugin listens on `window` (bubble phase) and would walk the avatar or toggle the walk grid while the operator reads or types; stopping keys in the window's capture phase would also keep them from the reply box's React `onKeyDown` (React listens on the root, below the window), so Enter could not send. Letting key releases through keeps a key held at opening from staying down in Phaser after the panel closes.
Coupled: apps/agent-world/web/game/place-scene.ts
Verify: apps/agent-world/tests/world-conversation.test.ts

Tab and Shift+Tab are kept inside the panel (inside an open confirmation, if there is one) by `trapTab` from `overlay/focus.ts`, and closing gives the focus to the world's `#game` (`focusWorld`) in the effect's cleanup. The place panels and their confirmations do the same.
Hazard: a key pressed within about 150 ms of closing is lost by the world (seen with G in the tests); the cause is not yet found, and the focus test leaves 300 ms.
Coupled: apps/agent-world/web/overlay/focus.ts, apps/agent-world/web/overlay/places/place-dialog.tsx
Verify: apps/agent-world/tests/world-conversation.test.ts, apps/agent-world/tests/world-rookery.test.ts

A dormant character (its id in `world.dormant`) has no terminal: the side pane offers Wake (`placeActions.wake`) where awake ones have Go to its terminal, and the reply slot says how it wakes.
Verify: apps/agent-world/tests/world-inn.test.ts

`mark_seen` is sent when the panel opens on a character with `needsYouSince`, and again on a later settle only while the window has focus.
Why: opening is seeing (decision 17); a panel left open in a background window must not swallow "finished" for every other view.
Verify: apps/agent-world/tests/world-conversation.test.ts

The happy portrait stays while the conversation is open after seeing clears `unseen`, until the character works or asks again.
Why: marking seen on open would flip the face to neutral within a second of opening.

## symbol:Transcript

Replies being written (`useLiveReplies`) are drawn as assistant entries after the history, so `blocksOf` folds them into the agent's turn under one heading; at a stream's end the stored entry takes the streamed one's place with the same words, and it stays among the live entries until the history's own read holds its id.
Why: the history appends only what follows its last known entry, so pushing the stored entry into it directly would hide the tool results indexed before it; keeping it apart until the history reads it means it is never drawn twice, never missing, and never moves.
Coupled: apps/agent-world/web/overlay/conversation/live-reply.ts, apps/agent-world/web/overlay/conversation/history.ts
Verify: apps/agent-world/tests/world-conversation.test.ts

Older pages keep the view still by adding the growth of `scrollHeight` to `scrollTop` in a layout effect, with `overflow-anchor: none`, and the loading label (the theme's `conversation-older` line) sits outside the scrolling log.
Why: Chrome's own scroll anchoring does not act at `scrollTop` 0, and anything inserted above the entries while a page loads moves them without a first-entry change the effect can see.
Coupled: apps/agent-world/web/overlay/conversation/conversation.css, apps/agent-world/web/overlay/conversation/history.ts
Verify: apps/agent-world/tests/world-conversation.test.ts
