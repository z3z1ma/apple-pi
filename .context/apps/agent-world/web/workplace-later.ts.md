## file

Later, pinned threads and mutes are device-local lists, one localStorage key each, shared by every view through a module cache plus a same-window change event and the cross-window `storage` event. Muting changes only presentation: a muted DM or channel keeps its runtime unread state and is never acknowledged; the sidebar, the Chat rail badge and Alt + Shift navigation each filter it out. Mute keys are `dm:<id>` and `channel:<id>`, the same keys sidebar sections use.
Why: none of these is organizational state agents should see, and muting must not mark anything read on the operator's behalf.
Coupled: apps/agent-world/web/workplace.tsx, apps/agent-world/web/workplace-desk.tsx, apps/agent-world/web/workplace-message-actions.tsx
Verify: apps/agent-world/tests/world-desk.test.ts
