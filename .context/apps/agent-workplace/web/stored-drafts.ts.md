## file

Unavailable localStorage leaves drafts in memory rather than preventing the composer from opening. This includes private-window storage refusals; persistence is best effort while the Map remains the current window's draft store.
Why: losing persistence must not turn a storage-policy failure into lost in-window edits or an unusable composer.

Coupled: apps/agent-workplace/web/workplace.tsx, apps/agent-workplace/web/overlay/conversation/panel-state.ts
Verify: apps/agent-workplace/tests/world-desk.test.ts, apps/agent-workplace/tests/world-conversation.test.ts
