## file

The connection is the execution's ownership boundary, not one connection per model call. Losing it closes the scope. Closing cancels this connection's requested turns, including attached peers' turns, while leaving attached people alive. A request cancellation addresses its turn; cancelling startup discards only that new person.

A lost connection cannot acknowledge cleanup. The caller reconnects the runtime and waits for the persisted scope to disappear; scopes outlive their nested scopes and every owned process and bundle. Cleanup errors remain visible. Results themselves are transient receipts, with the Pi transcript as their durable owner.

The schema check reports an old running daemon rather than sending a protocol message it would ignore. Updating the checkout alone leaves a daemon on its loaded code; restarting the operator's runtime is a separate rollout decision.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/protocol.ts, components/session-state/src/schema.ts
Verify: components/session-state/tests/program-peers.test.ts
