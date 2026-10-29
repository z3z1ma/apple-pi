## file

The controller tests use an isolated migrated SQLite database and a Commands stand-in that records receipts/person incarnations. The retry regressions supply retained nested outbox rows because the stand-in does not naturally produce the actual runtime's assignment and mention-delivery command IDs. Pending assignment mail must not prevent retry of a failed start; pending delivery of an already-published readiness notice must not make completed startup unresolved.
Why: correlated command prefixes include both the operation and its later deliveries. Assertions use the public startup result and readable message counts, rather than pinning attempt numbers or SQL selection details.

Real thread posting, audience participation and channel reconciliation run underneath that stand-in. This checks the backend's command sequencing, identity/retry decisions, emitted progress, kickoff/readiness addressing, and read-cursor preservation. It does not launch Pi, tmux, Electron, or prove daemon/startup bridge behavior; runtime and real-host suites own those seams.

Lost accepted starts are intentionally distinct from failed starts. Failed provisional people retry without another goal, a later connected incarnation resolves uncertainty without another launch, and proven stopped people can wake under their retained identity. Channel message assertions check both readable content and the actual push-recipient list so late readiness cannot accidentally start every report. Operator read preservation is checked through thread unread counts after one seen and one unseen channel message, rather than asserting a stored cursor value. The cycle case uses a managing role so it reaches reporting-cycle validation instead of failing an unrelated capability check.
Why: resetting a cursor and automatically advancing it are opposite defects with the same user impact: the unread conversation is wrong. One seen and one unseen message distinguish both. Independent valid role data keeps the cycle test sensitive to an actual graph-validation regression.

Readiness cases distinguish an initially ready person restarting from an already-awake person joining after a blocked move. Both use public progress, channel messages and push recipients. The immutable-input regression specifically changes a prepared person's goal; role and directory comparisons are present in production but not separately exercised by that case.
Why: the old timestamp-based rule confuses process lifetime with team readiness. Naming exactly the mutated input keeps the test's proof narrower than the complete production guard.

Coupled: apps/agent-world/src/backend/org.ts, apps/agent-world/src/org.ts
Verify: apps/agent-world/tests/org-backend.test.ts, apps/agent-world/tests/org-runtime.test.ts
