## file

This is Workplace-only orchestration over ordinary runtime start. It walks current recorded ancestry through awake intermediates to the head, rejects missing/former/temporary/cyclic relationships and unapproved absent people, and rechecks after locating the operator's tmux pane and before subsequent starts. It neither moves people nor creates tasks; the lifecycle callback sends no replacement cwd/name/role/goal/prompt, so the runtime reopens the existing identity with normal focused-work resume. Old World wake is separate and remains selected-only.

The runtime owns all writes. This reader opens the database query-only; the existing commands journal supplies attempt identities and receipts. The in-memory map only coalesces one active request id with identical consent. Failed attempts can retry with another attempt id; accepted/delivered attempts stay uncertain until observed connected. When no journal record exists, a retry uses the same attempt id, so a lost response cannot create another launch merely because the app restarted. An already applied operation does not reopen someone who later stopped; that needs a new explicit request.

A receipt alone does not prove current readiness. Even applied without a connected incarnation is uncertain. Final results recheck previously joined people so an ancestor that stops during a descendant launch is not reported ready; its applied receipt remains intact. Failure/uncertainty stops dependent launches and preserves earlier people without rollback. A bridge-lost incarnation is not another sleeper. This is observed state, not an atomic guarantee against later process death or reporting changes.
Why: a receipt records an earlier boundary, while ready/active describes the currently observed incarnation. Rolling back a partial call-in could stop someone who has already resumed assigned work.

The ordinary lifecycle wait can return accepted/delivered after its existing deadline. Those receipts are preserved, not promoted to applied or treated as readiness. Missing tmux placement refuses before a start; this path does not borrow Org team's headless fallback or kickoff policy.
Coupled: apps/agent-world/src/call-in.ts, apps/agent-world/src/backend/lifecycle.ts, apps/agent-world/src/backend/commands.ts, components/session-state/src/runtime.ts
Verify: apps/agent-world/tests/call-in.test.ts
