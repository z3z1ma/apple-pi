## file

The desk is a stored preference (`desk`: `{thread, person}`) read by the backend and by the runtime's external-thread routing; the UI writes it only through `setDesk` after creating the channel, never by guessing from a channel name. Desk posts pass the coordinator as `listener`, which ThreadPane adds to every post's notify list; channels are pull, so without it the coordinator would never be pushed.
Why: the operator chose the coordinator's channel as the default composer, and only explicit notify requests attention.

Task threads open in the side panel through the ordinary ThreadPane. The runtime lets the operator post in any task thread (joining as a pull participant), so a reply reaches its push members.
Coupled: apps/agent-world/web/workplace.tsx, apps/agent-world/web/workplace-thread.tsx, apps/agent-world/src/backend/world-backend.ts, components/session-state/src/communication.ts
Verify: apps/agent-world/tests/world-desk.test.ts
