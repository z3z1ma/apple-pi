## file

Incorporation belongs to the current root. A reporting move reads status from the source root before changing the tree; a split keeps it, while a merge uses the target root's current status. Historical per-person flags cannot override the current tree. Migration protects every existing identity, including sleeping roots and reports; new admissions default temporary.

Closing intent is a durable incarnation-bound snapshot, not missing liveness. `requireDissolution` rechecks that snapshot, current membership and current blockers before the permanent departure commit. Reopening/incorporating cancels future departures, never reverses an existing permanent marker or its remaining safe cleanup. Root-last ordering includes report rows already marked departed but still awaiting cleanup.

Held assignments, owned unfinished reviews, reports, program resources and active/pending input block automatic departure. Unassigned backlog deliberately does not: the operator chose to retain those tasks without retaining the organization. Existing departureCandidate remains authoritative for responsibility, temporary identity and observed-process guards. The status reader describes blockers but does not authorize a departure.

An older schema represents the old kept-organization behavior. Query-only readers can render that state while an explicit new mutation still requires the current runtime. This does not establish activation or correct close intent from an old bridge.

Coupled: components/session-state/src/runtime.ts, components/session-state/src/schema.ts, components/session-state/src/tree.ts, apps/agent-workplace/src/backend/org.ts
Verify: components/session-state/tests/organization-lifetime.test.ts, components/session-state/tests/event-index.test.ts
