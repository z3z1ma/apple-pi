## file

Mail commands use the `operator` address without an incarnation generation. Reads go through the query-only database; marking the returned messages read and replying go through the runtime. A new message after a read keeps its unread cursor until another explicit read.
Why: operator mail must not be bound to a session incarnation, and replying through `talk` would bypass the conversation and omit copied participants.
Coupled: components/tmux-sessions/sidebar/model.py, apps/agent-world/src/backend/mail.ts, components/session-state/src/threads.ts
Verify: components/tmux-sessions/sidebar/tests/test_mailbox.py
