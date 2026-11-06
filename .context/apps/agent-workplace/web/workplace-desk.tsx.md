## file

Threads exclude tasks whose participants are only discarded or temporary review/program peers. Custom sidebar sections and placements stay device-local.
Why: internal execution machinery is not an operator conversation, and personal sidebar organization is not shared organizational state.

The desk is a stored preference (`desk`: `{thread, person}`) read by the backend and by the runtime's external-thread routing; the UI writes it only through `setDesk` after creating the channel, never by guessing from a channel name. Desk posts pass the coordinator as `listener`, which ThreadPane adds to every post's notify list; `setDesk` also makes the coordinator the channel's runtime listener, which pushes every post and wakes it when away. The UI notify keeps working against a runtime older than channel listeners.
Why: the operator chose the coordinator's channel as the default composer; channels are pull, so without one of these the coordinator would never be told.

There is one desk (operator, 2026-11-06). It is active in the workspace that holds its coordinator; every other workspace's Desk says where it is run from, with Go there (switches workspace) and Run the desk from here (the ordinary coordinator picker, which moves it). Desk candidates are the coordinators in the current workspace, at any depth, and hiring one makes it report to the workspace root, so the new coordinator joins this workspace instead of founding another.

Groups are team channels (`team:<manager>`) shown as their people; organization and topic channels stay under Channels. Activity's "new" state is local to the device: an item is new until Activity was open while it was listed, keyed by item and time so a repeated question counts again.

Task threads open in the Threads view as a full conversation beside the list (an inbox split; below 1250 px the conversation replaces the list with a back button), from every entry point: the list, the desk's in-flight strip, Cmd-K, Activity, Later and pinned sidebar rows. The operator rejected the squeezed side rail but wanted threads to feel like channels; "Add to sidebar" pins a thread as a sidebar row (kept on the device) without turning all 30+ in-flight threads into channels. The runtime lets the operator post in any task thread (joining as a pull participant), so a reply reaches its push members.
An in-flight task is "Working" only while an assignee has it focused and that person's status is working; any other in-flight task is "Waiting". The desk strip, the Threads list and filter, and the thread header all use `workingOn`.
Why: a person working on a different task made every task they held read as active, hiding stalled assignments.

A live thread's header unsticks it: Nudge (only while Waiting) DMs each holder, waking one who is away; the Task menu reassigns (assign the new person first, then unassign the others, so the task is never held by nobody), closes an ephemeral task as done or cancelled through the runtime `close` action, and pins it. Ledger tasks get no close: their status belongs to `ledger_status`. The result shows as a short note in the header's state line, not as another button.

A desk message shows the task it produced (an unresolved `message produced task` link, which the coordinator records when it makes the task) as a Slack-style thread line under it, and "Reply in thread" on its menu; both open that task's thread. Without a recorded link nothing is inferred from titles.

Coupled: apps/agent-workplace/web/workplace.tsx, apps/agent-workplace/web/workplace-thread.tsx, apps/agent-workplace/src/backend/world-backend.ts, apps/agent-workplace/src/backend/workplace.ts, roles/coordinator.md, components/session-state/src/communication.ts
Verify: apps/agent-workplace/tests/world-desk.test.ts
