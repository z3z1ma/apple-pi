Status: open
Created: 2026-08-15
Updated: 2026-08-15

# Bootstrap gated task-local work items

## Scope

Implement canonical optional `WI-###` work items across task parsing, leased digest-checked mutation, executor proposals, independent-review context, exact judge confirmation, additive receipts, and Ralph closure. This is a self-hosting prerequisite: implementation occurs with the main coding agent outside Ralph, followed by full validation, independent review, and Pi reload before dependent work uses Ralph.

## Non-goals

- Active-task session pointers, task picker UI, or the unified operations hub.
- Priorities, tags, due dates, assignment, nested work-item dependencies, or a separate todo database.
- Treating implementation work items as behavioral acceptance evidence.
- Budget-policy or general architecture changes.

## Acceptance Criteria

- AC-001: One canonical parser accepts an absent Work Items section or valid open/complete/cancelled `WI-###` lines and reports misplaced, duplicate, malformed, or non-substantive items without silently dropping them.
- AC-002: Authorized add, reorder, complete, reopen, and cancel mutations hold the canonical task-bundle lease and queued digest compare-and-swap; invalid input, drift, or foreign ownership leaves task bytes unchanged.
- AC-003: Executors can only propose substantive completion evidence for known open IDs, independent review receives those proposals, and judges must confirm or reject exactly the proposed set without inventing mutation authority.
- AC-004: The controller completes only judge-confirmed IDs, recompiles task authority, leaves rejected IDs open, and refuses closure for any open or malformed work item independently of complete acceptance evidence.
- AC-005: Ralph schema-v2 receipts add validated proposal, judgment, confirmed/rejected, and resulting work-item state while existing schema-v2 receipts remain loadable and schema-v1 remains audit-only.
- AC-006: Executor/judge skills, ledger/Ralph documentation, task parser, mutation, receipt, state-machine, no-WI compatibility, and closure tests describe and protect the full contract.
- AC-007: The implementation is completed outside Ralph, passes targeted and full validation plus independent review, and Pi is reloaded before a dependent WI-bearing task is inspected or run with Ralph.

## References

- `.ledger/202608151843-bootstrap-gated-work-items/specs/work-items.md`
- `.ledger/202608151843-bootstrap-gated-work-items/plans/implementation.md`
- `.ledger/202608151843-bootstrap-gated-work-items/research/current-state.md`
- `components/ralph/src/work-graph.ts`
- `components/ralph/src/task.ts`
- `components/ralph/src/controller.ts`
- `components/ralph/src/roles.ts`
- `components/ralph/src/receipts.ts`
- `components/ralph/src/lease.ts`
- `components/ralph/src/types.ts`
- `skills/ralph-executor/SKILL.md`
- `skills/ralph-judge/SKILL.md`
- `docs/ledger.md`
- `docs/ralph.md`

## Assumptions

- User-ratified: stable gated `WI-###` work items are distinct from behavioral acceptance criteria.
- Record-backed: current Ralph ignores Work Items and loads role skills from disk between stages while parser/controller code stays in memory.
- Record-backed: task-bundle leases and digest compare-and-swap are the existing mutation authority to extend.
- Record-backed: `/reload` is required to activate controller, parser, schema, and skill changes coherently.

## Journal

- 2026-08-15: Split from the operations-hub task after identifying the legacy-closure and mixed old-code/new-skill self-hosting hazard.
- 2026-08-15: Declared manual main-agent implementation, independent review, full validation, and reload as the bootstrap boundary.

## Blockers

- Do not execute this task through the currently loaded Ralph runtime. Implement outside Ralph, then validate, independently review, and reload before dependent Ralph use.

## Evidence

Pending.

## Review

Pending.

## Retrospective

Pending.

## Distillation

Pending.
