## file

World's conversation draft Map and mounted operator-inbox draft state report distinct owners into this document-local aggregate. A nonempty aggregate marks the trusted iframe with data-world-dirty; Workplace's existing single beforeunload guard reads that marker even while the frame is hidden. Clearing one owner leaves another owner's unsent text protected. The parent has a different module instance, so inspecting only its own conversationPanel drafts cannot cover the child.
Each owner is a stable object identity: the conversation draft Map or a mounted inbox's ref. A replacement draft value updates that owner's flag rather than creating another owner. The parent reads the current frame marker when unloading instead of mirroring it in another React state.
Why: sharing AgentWorldApi across the same-origin frame does not share JavaScript module state. The marker joins the existing single unload decision without another IPC capability or prompt. It is UI state, not authority.
Coupled: apps/agent-world/web/workplace.tsx, apps/agent-world/web/workplace-world.tsx, apps/agent-world/web/overlay/conversation/panel-state.ts, apps/agent-world/web/overlay/places/operator-inbox.tsx
Verify: apps/agent-world/tests/world-navigation.test.ts, apps/agent-world/tests/world-terminal.test.ts
