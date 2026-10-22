## file

The operator is an address, not a session row or incarnation. Its inbox comes from thread membership and read cursors; unread messages from others need the operator independently of whether the sender is still working. `readThread` marks only the last returned sequence read, through the runtime, so a message arriving during the read stays unread. Replies are `thread_post` commands as `operator`, never `talk` commands to one session.
Why: using a sender's `needs_you_since` conflates human mail with that session's prompts and completed runs, and prompting a sender would lose the thread's other participants.

The old `mail` view remains the traffic view for pushed deliveries (including script messages); the operator inbox is one row per conversation. A runtime older than threads yields an empty inbox rather than breaking the rest of the world.
Coupled: components/session-state/src/threads.ts, components/session-state/src/runtime.ts, apps/agent-world/web/overlay/places/operator-inbox.tsx, components/tmux-sessions/sidebar/mailbox_view.py
Verify: apps/agent-world/tests/operator-mail.test.ts, apps/agent-world/tests/rookery.test.ts
