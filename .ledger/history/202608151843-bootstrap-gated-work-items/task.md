Status: done
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
- 2026-08-15: Implemented the parser, leased mutation, controller proposal/judgment flow, receipt protocol, documentation, and deterministic regressions outside Ralph. Receipt replay now rejects malformed, mixed, wrong-stage, omitted-assessment, invented-ID, overlapping-ID, and repeated work-item event payloads.
- 2026-08-15: Addressed all five confirmed findings from independent review `dd57bbee-6763-40e1-adbd-5c8c3a329edc`: strict role and receipt record shapes, canonical receipt semantics and lifecycle progression, post-judgment authority drift, and done-task work-item invariants. Human `/review` completion now delivers a bounded verified follow-up to the model without interrupting active work or crossing session lifecycle boundaries.
- 2026-08-15: Validated the final patch in an isolated worktree, committed it as `1912531 Gate Ralph work item completion`, and pushed it to `origin/main`.
- 2026-08-15: Operator confirmed Pi reload after the commit, satisfying the final self-hosting activation gate before dependent Ralph use.

## Blockers

None.

## Evidence

- 2026-08-15: `npm run typecheck` passed.
- 2026-08-15: `npm test` passed: 421 tests across 39 files, 1,414 assertions; 79/79 advisor checks; package-loader validation passed.
- 2026-08-15: `npm run pack:check` passed with 158 package files.
- 2026-08-15: Focused Ralph parser, graph, receipt, and state-machine suites passed 34/34 after review remediation; `git diff --check` and package-loader validation passed.
- 2026-08-15: Isolated worktree `/tmp/apple-pi-bootstrap-verify.sW4YpJ` passed `npm run typecheck`, `npm test` (421 tests, 1,414 assertions; 79/79 advisor checks; loader validation), `npm run pack:check` (158 files), and `git diff --check`.
- 2026-08-15: Operator confirmed Pi reload after commit `1912531`, activating the parser/controller/skill changes before dependent Ralph use.

## Review

- 2026-08-15: Independent balanced workspace review `dd57bbee-6763-40e1-adbd-5c8c3a329edc` completed 18/18 selected items with five confirmed significant findings. All five were resolved with deterministic regressions, including the judgment → concurrent work-item description edit → leased completion CAS rejection path; receipt: `/Users/alexanderbut/.pi/agent/reviews/runs/f4e5ea2688032efb83a59f99/dd57bbee-6763-40e1-adbd-5c8c3a329edc.jsonl`.

## Retrospective

- Canonical typed submission still requires explicit runtime shape validation because tool schemas alone do not protect persisted or test-injected values; receipt replay must validate both payload content and the controller lifecycle that emitted it.

## Distillation

- No reusable promotion: this task's durable contract belongs in the existing Ralph role, receipt, task-mutation, and review-handoff documentation rather than a new repository-wide skill.
