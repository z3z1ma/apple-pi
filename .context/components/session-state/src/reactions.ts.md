## file

Reactions are a runtime-owned record (migration 45, `message_reactions`) written only through the `react` command, so they reach every reader through the ordinary message page and wake nobody: no delivery, no notify, no read-cursor change. The operator may react on any message it can read; a person only in conversations it takes part in. A DM message is a transcript entry, not a thread message: its key is `entry:<session>:<entry id>` (`entryReaction`), only the operator reacts there, and `read_entries` pages carry those reactions by entry id. Messages carry `reactions` only when there are some, so pages from older databases keep their shape.
Why: the operator wanted a quick acknowledgment that does not wake an agent for a typed "ok"; a local UI flag would never reach the agents.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/communication.ts, components/session-state/src/communication-types.ts, apps/agent-workplace/src/backend/communications.ts, apps/agent-workplace/web/workplace-thread.tsx
Verify: components/session-state/tests/reactions.test.ts, apps/agent-workplace/tests/world-desk.test.ts
