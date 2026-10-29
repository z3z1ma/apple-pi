## file

The operator is an address, not a session row or incarnation. Its inbox comes from thread membership and read cursors; unread messages from others need the operator independently of whether the sender is still working. `readThread` marks only the last returned sequence read, through the runtime, so a message arriving during the read stays unread. Replies are `thread_post` commands as `operator`, never `talk` commands to one session.
Why: using a sender's `needs_you_since` conflates human mail with that session's prompts and completed runs, and prompting a sender would lose the thread's other participants.

A participant read returns `readUpTo` from before acknowledging the returned history. Preview reads have no operator cursor. The workplace's new-message boundary uses that value; `lastSeq - unread` is not a cursor, because sequence numbers are global and own posts are excluded from unread counts. Posting also advances the sender's cursor through its own post.
Coupled: apps/agent-world/src/world.ts, apps/agent-world/web/workplace.tsx, components/session-state/src/threads.ts
Verify: apps/agent-world/tests/channel-membership.test.ts

Missing live author/participant labels fall back to the retained departure name through the shared Node-safe thread reader. Existing live names/cwd labels and operator rendering take precedence. This recovers attribution, not a live person, profile or new thread access.
Why: deleting a session row must not turn preserved shared messages or legacy traffic into anonymous UUIDs; importing an SDK producer into the Electron backend would break its plain-Node boundary.
Coupled: components/session-state/src/departures.ts, components/session-state/src/threads.ts
Verify: apps/agent-world/tests/departure-mail.test.ts

The old `mail` view remains the traffic view for pushed deliveries (including script messages); the operator inbox is one row per conversation. A runtime older than threads yields an empty inbox rather than breaking the rest of the world.
Coupled: components/session-state/src/threads.ts, components/session-state/src/runtime.ts, apps/agent-world/web/overlay/places/operator-inbox.tsx, components/tmux-sessions/sidebar/mailbox_view.py
Verify: apps/agent-world/tests/operator-mail.test.ts, apps/agent-world/tests/rookery.test.ts

`readStoredThread` is a database reader, not an authorization check. The operator inbox checks membership before using it; the workplace observer restricts it to shared channel, meeting, and task threads and changes no cursor unless the operator participates.
Coupled: apps/agent-world/src/backend/workplace.ts
Verify: apps/agent-world/tests/workplace.test.ts
