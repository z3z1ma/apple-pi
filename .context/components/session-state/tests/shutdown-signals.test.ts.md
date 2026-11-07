## file

EventEmitter controls mirror the installed host's prepend/removal order, including a signal delivered before the observer's queued reorder. They establish classification, continued host callback delivery after observer disposal, and absence of residual signal handlers after host callbacks are removed; they do not establish real terminal/window or operating-system behavior.
Why: checking a newListener hook count binds the test to the ordering implementation rather than whether disposal preserves host signal handling and relinquishes its own signal interception. The runtime/socket suite separately checks missing and false provenance plus explicit executed close IDs.

Coupled: components/session-state/src/shutdown-signals.ts, components/session-state/src/bridge.ts
Verify: components/session-state/tests/shutdown-signals.test.ts, components/session-state/tests/organization-lifetime.test.ts
