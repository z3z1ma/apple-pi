## file

The command journal stores a bare CommunicationEffect in commands.result; native tools wrap it in CommunicationAttempt.effect. Projection queries select metadata fields from the stored effect and typed outbox references, leaving bodies and subjects behind ordinary conversation access checks. Frozen publication audiences take precedence over reconstructed participation; absent legacy explicit-notify data is unknown, not a quiet post.
Why: reading the native wrapper shape from storage silently loses publication evidence, while consulting today's participants/cursors can rewrite an earlier audience or acknowledgment history.

Receipt stages and catch-up watermarks are reconstructed at the cutoff from journal events, not inferred from current command status or read_up_to. A message-specific task link associates that message rather than the whole conversation. Assignment, focus and temporal proximity supply no discussion-to-task association.
Why: delivery, consumption, acknowledgment and understanding are separate facts; broadening one explicit link can make unrelated discussion look attributable to all of an owner's work.
Coupled: components/session-state/src/communication-types.ts, components/session-state/src/runtime.ts, components/session-state/src/threads.ts, components/session-state/src/work-inspection.ts, components/session-state/src/work-tools.ts
Verify: components/session-state/tests/coordination-inspection.test.ts, components/session-state/tests/work.test.ts, components/session-state/tests/communication-tools.test.ts
