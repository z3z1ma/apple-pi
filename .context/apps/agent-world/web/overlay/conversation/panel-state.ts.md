## file

Conversation text drafts outlive a modal reader in this document. The draft Map itself is the stable owner reported to world-drafts; its dirty state is the presence of any unsent text, not whether the current conversation is open. Hiding World disposes its reader but keeps this Map and its frame marker intact. Clearing one character's draft leaves other characters' drafts protected.
Why: the retained iframe has a separate module instance from Workplace. The parent's unload guard cannot discover these drafts through its own conversationPanel, and tying dirtiness to the mounted reader would lose protection precisely when the World tab is hidden.
Coupled: apps/agent-world/web/world-drafts.ts, apps/agent-world/web/workplace.tsx, apps/agent-world/web/overlay/conversation/actions.tsx, apps/agent-world/web/overlay/conversation/conversation-panel.tsx
Verify: apps/agent-world/tests/world-navigation.test.ts
