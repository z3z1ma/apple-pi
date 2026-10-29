## symbol:needsYou

Needs you lists questions first, then finished-and-unseen work, each oldest `needsYouSince` first; working and idle characters are never listed. Its membership is the backend's facts, which match the tmux sidebar; only the order differs (the sidebar mixes both kinds by time).
Why: the ticket asks for questions first; membership must match every other view.
Coupled: apps/agent-world/src/backend/facts.ts
Verify: apps/agent-world/tests/world-interface.test.ts

## symbol:activity

Only `running_tool` permits the retained tool to describe current activity. A snapshot can still carry the previous tool while its run state has moved to writing, thinking, or idle.
Why: a retained tool must not contradict the current typing indicator or make an idle session look busy. The conversation panel's detailed tool label follows this same guard.
Coupled: apps/agent-world/web/overlay/conversation/conversation-panel.tsx
Verify: apps/agent-world/tests/world-conversation.test.ts
