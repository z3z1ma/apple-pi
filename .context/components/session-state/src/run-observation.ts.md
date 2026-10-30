## file

A run follows the SDK's preparation-to-agent_settled lifetime, not one agent_start loop. Repeated continuation starts keep its identity. Preserve the initiating input separately from later consumed mail, and carry active identity/deduplication across reload only within the same process; a missing identity remains unknown.
Why: Pi can continue after agent_end, and a queued delivery can precede actual message consumption. Replacing the initiating input with later mail would relabel the earlier execution prefix.

The wire snapshot excludes the process-local consumed-ID set and selects only typed IDs/kinds/references from host input. The bridge keeps that snapshot current for reconnect hello messages. The snapshot does not resurrect private bodies or prove activity while the bridge was absent.
Why: serialization and reconnect coverage are different from in-process continuation; publishing the active object wholesale would expose implementation state and invite accidental private-input retention.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/protocol.ts, components/session-state/src/execution-inspection.ts, components/session-state/src/mail.ts, components/session-state/src/peer-turns.ts
Verify: components/session-state/tests/run-observation.test.ts, components/session-state/tests/execution-inspection.test.ts
