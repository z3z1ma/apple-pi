## file

The self's record is the session's own transcript (`organization-self` custom entries holding all four fields, the latest on the branch wins); the `self` column of `sessions` in the state database is a projection for the views (the fields rendered as `##` sections), reported in the hello and after each `update_self` over the `organization:self` events channel.
Why: the spec places the self with the person, and the transcript is the one record that follows a session through reopen, resume, fork, and a runtime whose database was deleted; a database-only self would vanish with the database and would need a read at start that the runtime may not yet serve.

The `<self>` system prompt section shows the self snapshotted at `session_start` and `session_compact`, not the latest; a reflection that rewrites the self delivers it as one appended custom message.
Why: any change to the system prompt invalidates the provider's cached prefix for the whole conversation. Compaction rebuilds the context anyway, so the snapshot moves only then; between compactions the appended message keeps the context append-only.

`update_self` executes only while this module's reflection fork runs (`reflecting` and `inForkedContinuation`); the tool stays registered and active everywhere.
Why: the fork reuses the parent's tool list so its request shares the parent's cached prefix; removing the tool from the main session would change the list. The refusal keeps rewriting out of the main model's hands.

The reflection before compaction starts in `session_before_compact` and returns nothing.
Why: `startFork` copies the projection synchronously, so the fork still holds the detail the compaction is about to remove; the compaction itself belongs to Pi's native summarizer, and a returned value would compete with that one owner.

`update_self` is added to the active tools at `session_start` and again at every `before_agent_start`.
Why: Pi restores the active tool set from the saved transcript after extensions load, so a session older than the tool, or one whose user disabled it, would otherwise run without it; every new root-session tool also lands in the `activeTools` the bridge records, which `activity.test.ts` checks with `arrayContaining`.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/protocol.ts, components/shared/src/forked-continuation.ts
Verify: components/organization/tests/person.test.ts, components/session-state/tests/coordinator.test.ts, components/session-state/tests/activity.test.ts
