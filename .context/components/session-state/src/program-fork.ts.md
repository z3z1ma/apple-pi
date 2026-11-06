## file

A program-owned native fork records one `program-fork` custom entry before its first bridge hello. Its data binds the new session ID, already-incurred cost and the byte offset at the end of the actual copied transcript. The source transcript can keep changing: neither cost nor the log boundary is inferred by rereading that source. SessionManager has already loaded/migrated and persisted the new fork before this marker is appended.

The marker belongs to its new session identity. A fork of a fork ignores inherited markers, records another boundary, and starts its own cost at zero. Cost sums only assistant entries after the current identity's marker; reconnect/reload retains that marker so genuine new work remains counted. Fresh temps and unowned ordinary sessions keep their prior cost behavior. Marker creation is startup-only: reloading an older bridge without one cannot honestly reconstruct the original fork boundary.

The bridge reports the offset as optional hello metadata; new runtimes retain it for the matching review attempt. Old runtimes ignore it. The log reader validates the identity-bound marker at that offset on every read and fails closed on missing/moved/invalid markers, including native rewrites. The marker is provenance, not user-visible conversation text or a second transcript store.
Why: copying a transcript under a new identity also copies private history and already-incurred usage. The ordinary fresh-peer zero baseline and a review's read permission establish neither content eligibility nor new spend.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/protocol.ts, components/session-state/src/runtime.ts, components/session-state/src/review-read.ts, tests/fixtures/peer-pi.mjs
Verify: components/session-state/tests/peer-history.test.ts, components/session-state/tests/review-workers.test.ts
