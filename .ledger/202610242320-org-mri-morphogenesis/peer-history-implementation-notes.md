# Accepted ticket 15 implementation notes

This is the accepted implementation plan for [Keep what history needs when temporary peers are discarded](tickets/15-keep-history-on-peer-disposal.md), not a completed repair. Its purpose is to make the same historical query return the same spend and assignment spans before and after temporary-peer cleanup, and to charge real peer costs and operator demands to their lasting caller.

A **temporary peer** is a session created for a `pi_exec` program and discarded when its scope ends. Its **caller** is the session that created it, independent of later reporting moves. For nested peers, the **accounting beneficiary** is the first caller in that creation chain that is not temporary. A **zero baseline** records that a newly created identity has no earlier transcript cost; it allows its first positive cost observation to count as spend. **Retained tasks** survive cleanup, unlike program-internal tasks removed with their peers.

Waylon supplied this source-based plan and an isolated actual-method baseline reproduction on 2026-10-26; Agnieszka accepted the refinements. Mail threads t-bece63f5 and t-cb8699c6 hold the discussion, but the decisions needed to implement it are stated below. Source locations are under `components/session-state/src/`. No implementation was delivered by that planning task.

## Producers

- Runtime.startSession inserts program_peers before the provisional person/work transaction. Atomically pair that launch-ownership insert with durable immutable caller/temporary identity in existing events and a zero cost_changed baseline for a NEW identity. Do this before any process or hello. Existing writeFacts baseline detection can then charge the first positive reconnect as new spend. Do not add a zero baseline to legacy peers.
- Before startup cleanup, a forward migration may preserve authoritative caller mappings from surviving program_peers.created_by. These are observed ownership facts, not invented creation timestamps. Previously discarded unknown callers remain unavailable. Old person_discarded events still prove temporary identity; do not reclassify them as lasting people.
- In discardProgramPeople's existing transaction, end still-open assignments on retained tasks rather than deleting them. Preserve already-ended spans/outcomes. Continue deleting assignments for tasks actually deleted and current work_focus.
- Reparenting retained reports must append standard transferred {from,to,by} with the snapshot/manager_changes mutation. The old facts {reportsTo} event was not read by historical replay.

## Distinct reader meanings

Keep active-person membership, structural reporting ancestry and accounting beneficiary separate. A temporary person stays excluded as a person; compute/questions/operator mail charge exactly once to the first lasting caller through immutable creation ancestry, under that caller's membership at observation time. Reporting moves do not change the accounting beneficiary. Durable caller supplies initial structural parent when current rows are gone; subsequent recorded moves still govern structural ancestry.

Update both task financial eligibility and cleanup classification to recognize disposed temporary IDs. Ending rather than deleting retained assignments otherwise makes a previously discarded temporary assignee look lasting during sequential cleanup. Internal-only tasks must remain excluded and eventually delete after their last temporary people are gone; tasks with actual lasting assignment history survive.

## Reuse retained facts

Verified source distinction: cleanup's per-person messages deletion removes transcript index rows, not thread_messages. Native operator mail/escalation messages and retained task work_changes/posts already survive. No new message store or focus ledger is needed. Preserve that coupling for ticket13.

## Implementation order and acceptance

Implement the creation/migration facts first, then the separate accounting reader and cleanup changes. Run the [ticket 15 acceptance cases](tickets/15-keep-history-on-peer-disposal.md) and these additional regressions before removing the exclusion disclosure:

- New creation writes/zero baseline fail atomically; an initial hello reporting $0 followed by a reconnect reporting $3 counts $3. An ordinary or legacy session's first observed transcript total of $12 remains a baseline.
- A temporary parent spending $2 and its child spending $3 charge the lasting caller $5 exactly once despite reporting transfers; caller nonmembership excludes earlier spend and demands.
- Real disposal preserves original lasting-dev-under-temp compute, retained-task inProgress spans, operator mail/questions and historical audience; post-disposal manager chain reflects reparenting.
- Sequential disposal of two temporary assignees neither promotes internal tasks into finance nor prevents final deletion. Include a genuinely lasting historical assignee variant.
- Migration retains observed caller through restart without inventing baselines or undoing transfers. Unknown historical callers/spans are explicit limitations, not fabricated recovery.
- Injected disposal failure rolls back assignment ends, reparenting, participation and deletion; retry leaves prior results stable.

Source/doc/context must retain observation-time outage placement and millisecond conventions. Remove the blanket temporary-peer exclusion only once actual new accounting cases pass; disclose irrecoverable prefeature gaps precisely.
