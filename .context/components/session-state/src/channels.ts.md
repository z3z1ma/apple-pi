## symbol:syncChannels

The runtime reconciles channels at startup, hello, manager/role/name changes, transfer, and retirement. Membership is derived from the reporting tree, except explicit invitations, which survive a move. Sleeping people remain members. Leaving the organization removes membership but preserves the thread's messages.
Why: readers are query-only, and moving teams must stop access to the old team's channel immediately; rebuilding all participants would also reset read cursors or erase cross-team invitations.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/threads.ts
Verify: components/session-state/tests/channels.test.ts
