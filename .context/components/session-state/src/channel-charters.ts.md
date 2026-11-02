## file

`threads.listener` and `threads.charter` arrive in schema version 43. The runtime's `channel_charter` command calls `setCharter` and records `charter_set` through `Runtime.event`, the journal's one writer. `preparePost` adds the listener to every channel post's push audience, even when the listener does not follow the channel, and appends the charter only to the listener's copy; other recipients see the plain post. Listener mail is ordinary mail, so an on-call listener at home is woken.
Why: a standing policy needs someone to apply it on every post without a new engine; making the listener a follower instead would change access and catch-up semantics.
Coupled: components/session-state/src/schema.ts, components/session-state/src/runtime.ts, components/session-state/src/work-tools.ts
Verify: components/session-state/tests/on-call.test.ts
