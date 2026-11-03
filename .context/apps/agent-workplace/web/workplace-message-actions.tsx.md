## file

Emoji reactions acknowledge a message without waking its recipient.
Why: a lightweight acknowledgment must not become an attention request or process launch.

Forwarding sends as the operator through the same paths a person would use by hand: an awake person gets the quote in their DM as `talk`, or as `follow_up` while they are busy, never `steer`; a person at home gets operator mail; a channel or task thread gets a post. "Send to desk" posts to the desk thread and names the desk's person in `notify` explicitly.
Why: a forward must not interrupt an agent mid-run (Enter in a DM interrupts by the operator's choice, a forward is not that choice), and a direct post bypasses the desk composer that otherwise adds the listener to notify.

`ReactionPills` and `toggledReaction` are the one reaction display and toggle for both channel/thread messages (keyed by message id) and DM messages (keyed `entry:<session>:<entry id>`, see `components/session-state/src/reactions.ts`); each host keeps only its own optimistic copy until its next read.

Reply, Forward and Save act on the selected words when the selection lies wholly inside the message; the toolbar buttons cancel `mousedown` so clicking them keeps that selection.
Coupled: apps/agent-workplace/web/workplace-thread.tsx, apps/agent-workplace/web/workplace.tsx, apps/agent-workplace/web/overlay/conversation/transcript.tsx, apps/agent-workplace/web/workplace-switcher.tsx, apps/agent-workplace/web/workplace-later.ts
Verify: apps/agent-workplace/tests/world-desk.test.ts
