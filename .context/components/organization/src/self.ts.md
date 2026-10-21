## file

The self's record is the session's own transcript (`organization-self` custom entries, the latest on the branch wins); the `self` column of `sessions` in the state database is a projection for the views, reported in the hello and after each `update_self` over the `organization:self` events channel.
Why: the spec places the self with the person, and the transcript is the one record that follows a session through reopen, resume, fork, and a runtime whose database was deleted; a database-only self would vanish with the database and would need a read at start that the runtime may not yet serve.

The self is a system prompt section, not a message.
Why: compaction never touches the system prompt, so the self needs no re-injection after it, and provider prefix caching breaks only when the self changes, not on every turn.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/protocol.ts
Verify: components/organization/tests/person.test.ts, components/session-state/tests/coordinator.test.ts
