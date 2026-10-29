## symbol:useHistory

`readPulse` records the run-state pulse at the start of a successful newest-page request, not at its completion. A state change while that request is in flight needs a later read; embedded DMs compare the two before acknowledging a result. Older-page reads leave this value alone. Refresh failures stay visible and leave the last successful pulse unchanged.
Why: a history that was ready for the previous run is not evidence that the newly settled reply was read. Normal bridge `turn_end` indexes the assistant before the idle pulse; this hook preserves the existing backend index/recovery semantics rather than creating a message-level cursor.
Coupled: apps/agent-world/web/overlay/conversation/conversation-panel.tsx, components/session-state/src/bridge.ts
Verify: apps/agent-world/tests/world-conversation.test.ts
