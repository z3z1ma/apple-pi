## file

The registry belongs to one invocation, while Python stores only opaque keys. Freeze the caller id and working directory when creating the registry: a later session switch must not turn an old call into work owned by the new session. Aliases for one attached person share a handle; closing it cancels these requests, never that person's process. New role handles launch lazily on their first goal.

The scoped runtime connection, not this module, owns process creation and disposal. Await its cleanup before reporting program settlement. Keep complete one-shot calls in the pending set through their per-person cleanup; clearing handles as soon as their model turn finishes can race the call's finally block. The connection's opening signal belongs to the invocation, so closing one handle cannot cancel another handle's connection setup.

Bound context lives beside the assigned goal. Runtime task cleanup, sharing, and promotion therefore own its lifetime; there is no second temporary-file lifetime to guess. Terminal receipt observation records usage and operations even when cancellation rejects the awaiting request.

Coupled: components/session-state/src/program-client.ts, components/session-state/src/program-peers.ts, components/pi-exec/src/host-calls.ts, components/pi-exec/src/peer-python.ts
Verify: components/pi-exec/tests/peer-calls.test.ts, components/session-state/tests/program-peers.test.ts
