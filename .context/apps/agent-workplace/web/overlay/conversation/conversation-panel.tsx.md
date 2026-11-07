## symbol:Panel

While open as a modal, a capture-phase `keydown` listener on `window` stops every key aimed outside the panel and turns Escape into `conversationPanel.escape()` (a confirmation first, then the panel); keys aimed inside the panel go on to its fields and React handlers, and a bubble-phase listener on `document` stops them there. `keyup` is left alone.
Why: Phaser's keyboard plugin listens on `window` (bubble phase) and would walk the avatar or toggle the walk grid while the operator reads or types; stopping keys in the window's capture phase would also keep them from the reply box's React `onKeyDown` (React listens on the root, below the window), so Enter could not send. Letting key releases through keeps a key held at opening from staying down in Phaser after the panel closes.
Coupled: apps/agent-workplace/web/game/place-scene.ts
Verify: apps/agent-workplace/tests/world-conversation.test.ts

Workplace embeds the same panel as a region, with no modal key listeners or focus trap. The shell unmounts the embedded reader when Chat is hidden. Link/terminal and mark-seen failure notices belong in the shared main pane, not only the character sidebar.
Why: the shell has no Phaser scene and must keep sibling navigation available; a hidden reader would swallow unseen results. The embedded layout hides the character sidebar, so notices there would silently disappear even though the failed operation still occurred.
Coupled: apps/agent-workplace/web/workplace.tsx, apps/agent-workplace/web/workplace.css
Verify: apps/agent-workplace/scripts/workplace-smoke.mjs

In the modal, Tab and Shift+Tab are kept inside the panel (inside an open confirmation, if there is one) by `trapTab` from `overlay/focus.ts`. Cleanup returns focus to the world's `#game` (`focusWorld`) only while World is visible; hiding the retained World tab leaves focus in Workplace. The place panels and their confirmations keep their existing close-to-game behavior.
A key pressed right after closing was once "lost": Escape's release and G's press and release fell in one Phaser frame, and Phaser's keyboard plugin handles its whole queue again for each new key event, so G toggled the grid twice. `PlaceScene.toggleGrid` now handles each event once (`handledKeys`); any new `keydown-<KEY>` toggle in a scene needs the same guard.
Coupled: apps/agent-workplace/web/overlay/focus.ts, apps/agent-workplace/web/overlay/places/place-dialog.tsx
Verify: apps/agent-workplace/tests/world-conversation.test.ts, apps/agent-workplace/tests/world-rookery.test.ts

An ordinary dormant character (its id in `world.dormant`, without a retirement time) has no terminal: the side pane offers Wake (`placeActions.wake`) where awake ones have Go to its terminal, and the reply slot says how it wakes. A retained former entry is read-only: no Wake/terminal action or instruction to wake it. Permanent departure and ordinary dormancy are separate; a former row is not permission to recreate its person.
Verify: apps/agent-workplace/tests/world-inn.test.ts

The World modal retains its opening/settle `mark_seen` behavior only while its host is visible. The retained World tab unmounts the modal reader while hidden but preserves panel selection and draft text in the existing panel store. Queued acknowledgments recheck the actual frame visibility before invoking the API; hidden cleanup leaves focus in the parent rail rather than refocusing the game. Embedded DMs wait for a successful newest-page read for the current run-state pulse, focus, and the latest scroll position before marking a need seen. One request per needs timestamp keeps unrelated rerenders from repeating it. A failed history read leaves the update unread. An inline browser page also gates acknowledgment: its retained transcript is hidden even though the document and DM remain visible. Returning reuses the focus/current-history/latest barriers after layout restores the visible reading position.
Why: selecting the DM or receiving a settled snapshot is not enough when its latest page is still in flight, the operator is reading older content, the window is inactive, or an inline page covers the transcript.
Verify: apps/agent-workplace/tests/world-conversation.test.ts

The workplace's activity indicator follows the live run state: only `writing_reply` says typing; thinking, running tools, and compaction retain their own labels. Idle, sleeping, and asking states show no animated typing. Only `running_tool` adds current tool detail to the lower single-line, ellipsized indicator, with the full text available on hover. The DM header stays compact. Text-only mode filters all nonconversation details, including historical failures; current read/send/link failures remain operational feedback. The history and stream hooks retain all data.
Verify: apps/agent-workplace/tests/world-conversation.test.ts

The happy portrait stays while the conversation is open after seeing clears `unseen`, until the character works or asks again.
Why: marking seen on open would flip the face to neutral within a second of opening.

## symbol:responseAnchor

The first visible response container and its viewport offset anchor an away reader through structural regrouping. `data-response` identifies every assistant response even when it shares an outer article; live-to-saved IDs resolve through the stream completion callback's replacement map. This metadata is for scrolling, separate from canonical `data-entry` link/reaction identity.
Coupled: apps/agent-workplace/web/overlay/conversation/transcript.tsx, apps/agent-workplace/web/overlay/conversation/live-reply.ts
Verify: apps/agent-workplace/tests/world-conversation.test.ts

## symbol:Transcript

Replies being written (`useLiveReplies`) are drawn as assistant entries after the history. `blocksOf` groups adjacent responses below five minutes on the same local day, with the embedded reader's retained unread boundary passed into grouping before the New divider is placed. Both World and Chat share the time/day rule. At a stream's end the stored entry takes the streamed one's place with the same words and its persisted timestamp; it stays among the live entries until the history's own read holds its id. A single stream remains a single response even across delayed deltas; its saved timestamp can change grouping.
Why: the history appends only what follows its last known entry, so pushing the stored entry into it directly would hide the tool results indexed before it. Keeping it apart until history reads it avoids duplicate or missing replies. Splitting at the unread boundary keeps already-read text outside the New block.
Coupled: apps/agent-workplace/web/overlay/conversation/live-reply.ts, apps/agent-workplace/web/overlay/conversation/history.ts
Verify: apps/agent-workplace/tests/world-conversation.test.ts

Embedded transcripts retain the opening unread boundary from `seenAt` and show New before the first visible assistant block after it. This is a run/update signal, not a message count. They start at a loaded unread boundary when available, preserve an older reading position as replies arrive, and offer Jump to latest. The wrapper and jump styles stay workplace-scoped; World's modal keeps its usual layout.
Coupled: apps/agent-workplace/web/workplace.css, apps/agent-workplace/web/use-window-focus.ts
Verify: apps/agent-workplace/tests/world-conversation.test.ts

Header splits/merges restore an away reader's response offset. The corresponding programmatic scroll event retains away intent; a later history adoption cannot promote that reader to latest just because a removed header reduced the remaining distance below the threshold. User scrolling, Jump to latest and sending remain the ways to resume following. Layout may demote a previously following reader when its position changes, while promotion comes from those actions. A resolvable response anchor takes priority over first-key height compensation: replacing the first live entry changes that key without prepending content. Content added below its visible paragraph must not be counted as growth above it.

While an inline page hides the retained transcript, skip layout, scroll handling and geometry-driven older-page loading. Keep the last visible height, structure, response anchor and away state. Reveal reconciles that retained anchor even if grouping did not change; zero-size hidden geometry is not a new reading position. A send while hidden remains an explicit latest action when the transcript returns. After initial placement, apply a pending sent counter before either response-anchor restoration or first-key compensation. A visible-started older-page request may legitimately finish while hidden and change that first key; recording sent without applying it would lose the explicit latest action.
Why: a saved completion timestamp can add or remove a header above the visible text; retaining scrollTop alone moves the paragraph and can acknowledge unseen updates after a merge. Hiding the log can reset scrollTop before reveal, with or without a timestamp split.
Coupled: apps/agent-workplace/web/overlay/conversation/live-reply.ts, apps/agent-workplace/web/overlay/conversation/transcript.tsx
Verify: apps/agent-workplace/tests/world-conversation.test.ts

Older pages keep the view still with a resolvable response anchor while away, falling back to adding the growth of `scrollHeight` to `scrollTop` when the first key changes. This runs in a layout effect, with `overflow-anchor: none`, and the loading label (the theme's `conversation-older` line) sits outside the scrolling log.
Why: Chrome's own scroll anchoring does not act at `scrollTop` 0, and anything inserted above the entries while a page loads moves them without a first-entry change the effect can see.
Coupled: apps/agent-workplace/web/overlay/conversation/conversation.css, apps/agent-workplace/web/overlay/conversation/history.ts
Verify: apps/agent-workplace/tests/world-conversation.test.ts
