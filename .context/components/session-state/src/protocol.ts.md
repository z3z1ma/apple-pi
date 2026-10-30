## file

Versioned communication commands are runtime-owned, not bridge execution requests. Their original input and canonical operation allow exact-attempt recovery before alias/thread generation. New callers fail on older runtimes rather than silently losing access/notification semantics. Mail kind/reference are optional because retained legacy outbox rows cannot infer them from titles; new publication supplies both.

Communication effects remain on the existing command journal. Receipt.result is still the original correlated turn owner's ephemeral result; retry receipt observation does not transfer its ownership.
Coupled: components/session-state/src/communication-types.ts, components/session-state/src/runtime.ts, components/session-state/src/bridge.ts
Verify: components/session-state/tests/communication-recovery.test.ts, components/session-state/tests/peer-turns.test.ts
