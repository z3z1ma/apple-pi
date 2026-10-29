## symbol:useHistory

Every queued request captures a lifetime token disposed when the reader unmounts or its API/character changes. Check that token at the deferred API invocation, completion and chained-refresh boundary; a hidden World frame also blocks a new read before React finishes disposal. An already accepted API request may finish, but its completion cannot create another request for an absent reader. The lifetime effect's API/character dependencies are intentional even though its body creates only the token. Keep its setup before the opening-request effect so that request captures the newly active owner. Invalidate the captured object rather than reusing a mounted boolean that a later setup could turn back on.
Why: suppressing state updates alone left refresh's pending-again flag able to issue a new transcript read after the World tab hid its modal. Invocation and follow-up ownership must both end with the reader; a new reader lifetime must not revive an old request.
Coupled: apps/agent-world/web/world-visibility.ts
Verify: apps/agent-world/tests/world-navigation.test.ts

`readPulse` records the run-state pulse at the start of a successful newest-page request, not at its completion. A state change while that request is in flight needs a later read; embedded DMs compare the two before acknowledging a result. Older-page reads leave this value alone. Refresh failures stay visible and leave the last successful pulse unchanged.
Why: a history that was ready for the previous run is not evidence that the newly settled reply was read. Normal bridge `turn_end` indexes the assistant before the idle pulse; this hook preserves the existing backend index/recovery semantics rather than creating a message-level cursor.
Coupled: apps/agent-world/web/overlay/conversation/conversation-panel.tsx, components/session-state/src/bridge.ts
Verify: apps/agent-world/tests/world-conversation.test.ts
