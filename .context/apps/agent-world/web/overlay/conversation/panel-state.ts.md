## file

Conversation text drafts are stored per character under `workplace-draft:dm:<id>` in localStorage (`stored-drafts.ts`), so they survive reloads, relaunches and hiding World; both the Workplace document and the World frame read and write the same keys, one key per draft, so neither overwrites the other's drafts. Because nothing is lost on unload, drafts no longer mark the World frame dirty or hold the beforeunload guard; the guard remains for Code edits, live terminals, planned teams and World inbox drafts.
Why: the operator was asked to confirm Quit whenever any draft existed; Slack keeps drafts instead.

A reply target (`setReplyTo`) is per character and in memory only; the open reply box shows it and sends its quote above the words.
Coupled: apps/agent-world/web/stored-drafts.ts, apps/agent-world/web/world-drafts.ts, apps/agent-world/web/workplace.tsx, apps/agent-world/web/overlay/conversation/actions.tsx, apps/agent-world/web/overlay/conversation/conversation-panel.tsx
Verify: apps/agent-world/tests/world-desk.test.ts, apps/agent-world/tests/world-navigation.test.ts
