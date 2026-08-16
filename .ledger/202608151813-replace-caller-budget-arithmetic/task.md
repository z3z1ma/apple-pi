Status: open
Created: 2026-08-15
Updated: 2026-08-15

# Replace caller-configured budget arithmetic with harness-owned limits

## Scope

Redesign review, Ralph, subagent, and Pi Exec execution limits so ordinary model calls express task intent rather than numeric resource guesses. Controllers must derive practical allowances from known workload and trusted policy while retaining explicit hard safety ceilings, usage accounting, cancellation, bounded concurrency, and honest terminal outcomes. Trusted human or configuration surfaces may retain expert overrides where they have a clear operational use.

## Non-goals

- Removing cancellation, safety ceilings, resource accounting, or receipt usage data.
- Allowing unlimited parallel model or host execution.
- Treating an exhausted limit as successful completion.
- Changing model routing except where a semantic effort/profile contract intentionally owns both routing and internal limits.
- Reorganizing unrelated modules; the later architecture-convergence task owns structural cleanup after this API settles.

## Acceptance Criteria

- AC-001: Normal model-facing review, Ralph, Agent, nested-Agent, and Pi Exec schemas no longer ask the model to choose raw token, turn, timeout, group-count, concurrency, memory, call-count, or worker-count budgets.
- AC-002: Review and Ralph accept semantic intent only where it changes expected behavior, derive internal allowances deterministically from sealed workload characteristics and trusted policy, and record the resolved policy in run state and receipts.
- AC-003: Public Agent runs default to agent definition or trusted settings and otherwise remain unlimited by turns; internal managed roles retain controller-owned hard turn, token, timeout, compaction, and tool-policy gates.
- AC-004: Pi Exec retains bounded calls, concurrency, agents, memory, and elapsed time without requiring normal model calls to estimate those values; any expert override is human/config-owned and cannot silently bypass package maxima.
- AC-005: Operator stop, external interruption, timeout, token ceiling, turn ceiling, compaction, provider error, authority denial, and workspace conflict remain distinct causes through agent records, controller gates, receipts, tool results, and UI copy.
- AC-006: Defaults do not prematurely terminate the existing representative review and Ralph test workloads, and scaling tests demonstrate larger sealed inputs receiving sufficient internal allowance while package hard maxima still stop runaway work.
- AC-007: Existing persisted review and Ralph receipts remain loadable or receive an explicit audit-only migration boundary; no run is resumed under ambiguous budget semantics.
- AC-008: Slash commands and trusted settings document any retained expert controls separately from the model-facing tool contract, including defaults, maxima, and consequences.
- AC-009: README, review, Ralph, subagent, Pi Exec, package-loader, schema, controller, and terminal-outcome tests are reconciled with the new ownership model.

## References

- `.ledger/202608151813-replace-caller-budget-arithmetic/research/current-state.md`
- `components/review/src/index.ts`
- `components/review/src/controller.ts`
- `components/ralph/src/index.ts`
- `components/ralph/src/controller.ts`
- `components/subagents/src/index.ts`
- `components/subagents/src/service.ts`
- `components/subagents/src/agent-runner.ts`
- `extensions/runtime.ts`
- `docs/review.md`
- `docs/ralph.md`

## Assumptions

- User-ratified: numeric budget selection by the model is a bad product experience and current defaults have caused premature failures in use.
- Record-backed: omitted values already select defaults, so removing fields from model schemas does not remove the underlying safety machinery.
- Record-backed: hard ceilings, accounting, and honest incomplete outcomes are safety invariants and must remain controller-owned.
- Record-backed: humans and trusted configuration are the appropriate authority for rare numeric overrides.

## Journal

- 2026-08-15: Opened after tracing model schemas, command options, defaults, nested budget propagation, managed-agent enforcement, and abort classification across review, Ralph, subagents, and Pi Exec.
- 2026-08-15: Chose intent-based model contracts with retained internal hard limits; exact scaling and compatibility policy remain to be specified.

## Blockers

- An active specification must define semantic profiles, workload-to-limit derivation, trusted override surfaces, explicit stop-cause types, and persisted receipt compatibility before implementation.

## Evidence

Pending.

## Review

Pending.

## Retrospective

Pending.

## Distillation

Pending.
