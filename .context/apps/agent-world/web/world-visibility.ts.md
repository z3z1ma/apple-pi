## file

The child reads the shell's actual ancestor `hidden` attribute through its same-origin frameElement, not a cached message boolean. WorkplaceWorld notifies after changing that attribute because hiding an iframe this way does not change its document.visibilityState. Native document visibility remains a second gate. Standalone World has no frame and uses only that document visibility check. Keep the parent hiding mechanism and this predicate coordinated; arbitrary CSS visibility rules are not detected here.

Conversation readers use the hook to release watches while hidden, retaining their selection/drafts in the existing panel store. Queued mark-seen and post-success inbox rereads also check visibility at invocation, so hiding between an effect and its deferred call cannot acknowledge unseen content. Shared-thread initial/manual reads resume only when the frame is visible. An API read already invoked while visible is not cancelled retroactively. This is a reader gate, not an IPC permission system.
Why: retaining panel state and suppressing new hidden reads are separate responsibilities; neither a visibility notification nor local effect cleanup can undo a read the backend already accepted.
Coupled: apps/agent-world/web/workplace-world.tsx, apps/agent-world/web/overlay/conversation/conversation-panel.tsx, apps/agent-world/web/overlay/places/operator-inbox.tsx, apps/agent-world/web/overlay/places/workplace.tsx
Verify: apps/agent-world/tests/world-conversation.test.ts, apps/agent-world/tests/world-workplace.test.ts
