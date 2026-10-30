## file

The runtime supplies the surrounding transaction and common publication callback. Effects, access/lifecycle changes, original read page/ack and all addressed outbox rows commit together on the existing journal. A publication receipt does not establish delivery, reading, agreement or work completion.

A channel invitation always records a durable grant, including already-derived access, and follows for the invitee. Self-join changes following only; leave preserves grants/cursors. Removing a grant retains derived access and following when that access survives. Invitations themselves are quiet; explicit notify requests attention. New-hire context is delivered separately by the existing startup owner.

Task audience/lifecycle stays work-owned; structural channels cannot be generically archived/reopened. Historical meetings retain their kind but use ordinary reversible lifecycle. Pin changes remain valid on archived conversations. Operator recovery of an orphan restores a conversation, not a deleted person or a public grant.

Acknowledgment uses the page's resolved view, including on an omitted-view continuation. Failed acknowledgment keeps the fetched bodies and last confirmed cursor in the persisted effect. Recent/range inspection never acknowledges history.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/threads.ts, components/session-state/src/channels.ts, components/session-state/src/communication.ts
Verify: components/session-state/tests/communication-core.test.ts, components/session-state/tests/communication-tools.test.ts
