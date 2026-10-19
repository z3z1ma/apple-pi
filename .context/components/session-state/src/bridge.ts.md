## symbol:StateLink.close

A link closed without a reason (a reload, or a new `session_start` replacing the link) sends no shutdown, so the next bridge in the same process resumes the same incarnation; only a real session end sends one.
Why: a shutdown ends the incarnation, so sending it on reload recorded a fake process exit and a new generation for the same pid.
Verify: components/session-state/tests/runtime.test.ts

A link whose connection drops starts a runtime once and keeps reconnecting. Tests must end faux sessions with `session_shutdown` (the `close` helper), not `dispose` alone.
Why: a disposed session's link stays connected; when the test stops the runtime, the link starts a new one into a directory the test is deleting, leaving a stray daemon.
Coupled: components/session-state/tests/helpers.ts

## symbol:handedOver

Mail ids handed to Pi but not yet in the transcript live on `globalThis` per session id. They are cleared on every `session_start` except `reload`, and on every `agent_settled` that was not aborted.
Why: Pi's agent queue survives an extension reload, and the reloaded bridge receives the same unapplied mail again; an empty set would queue it twice. A completed run has recorded every queued steer; an aborted run may have discarded its queue (Escape) or kept it (RPC abort), so its ids wait for the next completed run.
Verify: components/session-state/tests/mail.test.ts

## symbol:StateLink.replyDelta

Reply deltas are transient: dropped while disconnected, never kept for a reconnect, and coalesced into one held delta while the socket needs draining. `send` flushes the held delta before any other message, so a stream's text always precedes its `reply_end`. The stream ends at `turn_end`, after `indexNew`, so the `messageEntryId` a client receives is already indexed.
Why: Pi's `message_update` callback must never wait, and a runtime that stops reading would otherwise queue a line per delta in the Pi process.
Coupled: components/session-state/src/runtime.ts
Verify: components/session-state/tests/bridge-backpressure.test.ts
