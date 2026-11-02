## file

The desk is a stored preference (`desk`: `{thread, person}`) read by the backend and by the runtime's external-thread routing; the UI writes it only through `setDesk` after creating the channel, never by guessing from a channel name. Desk posts pass the coordinator as `listener`, which ThreadPane adds to every post's notify list; `setDesk` also makes the coordinator the channel's runtime listener, which pushes every post and wakes it when away. The UI notify keeps working against a runtime older than channel listeners.
Why: the operator chose the coordinator's channel as the default composer; channels are pull, so without one of these the coordinator would never be told.

Groups are team channels (`team:<manager>`) shown as their people; organization and topic channels stay under Channels. Activity's "new" state is local to the device: an item is new until Activity was open while it was listed, keyed by item and time so a repeated question counts again.

Task threads open in the Threads view as a full conversation beside the list (an inbox split; below 1250 px the conversation replaces the list with a back button), from every entry point: the list, the desk's in-flight strip, Cmd-K, Activity, Later and pinned sidebar rows. The operator rejected the squeezed side rail but wanted threads to feel like channels; "Add to sidebar" pins a thread as a sidebar row (kept on the device) without turning all 30+ in-flight threads into channels. The runtime lets the operator post in any task thread (joining as a pull participant), so a reply reaches its push members.
Coupled: apps/agent-world/web/workplace.tsx, apps/agent-world/web/workplace-thread.tsx, apps/agent-world/src/backend/world-backend.ts, components/session-state/src/communication.ts
Verify: apps/agent-world/tests/world-desk.test.ts
