## symbol:syncChannels

The runtime reconciles channels at startup, hello, manager/role/name changes, transfer, and retirement. Membership is derived from the reporting tree, except explicit invitations, which survive a move. Sleeping people remain members. Leaving the organization removes membership but preserves the thread's messages.
Why: readers are query-only, and moving teams must stop access to the old team's channel immediately; rebuilding all participants would also reset read cursors or erase cross-team invitations.
Audience changes go through `participateIn`, including reconciliation at startup without an outer transaction. Revoking current channel access records a departure rather than erasing the earlier audience; explicit invitations that retain access produce no leave/rejoin pair.
Why: communication history must remain stable after ordinary team moves while former members immediately lose posting access.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/threads.ts
Verify: components/session-state/tests/channels.test.ts, components/session-state/tests/communication.test.ts, components/session-state/tests/participation.test.ts
