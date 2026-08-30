Status: done
Created: 2026-08-28
Updated: 2026-08-28

# Harden repository-wide harness correctness

## Intent

Resolve every confirmed defect and smaller correctness gap from the repository-wide harness audit.

## Outcome

Trust boundaries, lifecycle accounting, runtime contracts, durable mutation, compaction, search, and auxiliary integrations fail safely and have regression coverage.

## Scope

- Saved-program trust and Pi Exec failure, timeout, serialization, snapshot, and stdlib contracts.
- Subagent read-only enforcement, run ownership, resume behavior, ceilings, and activity.
- Pair/notebook trust, atomic maintenance, construction, escalation, and overflow protection.
- xAI compaction fallback and rejection attribution.
- Ledger, backlog, and shared to-do durability.
- Session-search safety, schema, and transcript identity.
- Notification latency, TypeScript test inclusion, and the Ralph Ledger review template.

## Non-goals

- Redesigning the harness or introducing compatibility layers.
- Changing the reconciled notebook packet behavior, which is not defective.
- Publishing, deployment, or unrelated cleanup.

## Acceptance Criteria

- AC-001: Untrusted project content cannot supply executable saved programs or Pair/notebook configuration.
- AC-002: Pi Exec implements its documented Bash, timeout, JSON, state-quota, and context-fit contracts.
- AC-003: Subagent runs have exclusive ownership, bounded continuations, correct background behavior, reliable activity, and exactly-once capacity release.
- AC-004: Notebook maintenance, Pair construction/escalation, and proactive overflow handling cannot lose or cross-wire session state.
- AC-005: xAI fallback preserves useful continuation context and disables opaque injection only for attributable rejection.
- AC-006: Ledger, backlog, and shared to-do mutation survives failure and concurrency without exposing partial state.
- AC-007: Session search is regex-safe, validates integer paging, and preserves real transcript turn identity.
- AC-008: Notification settlement is non-blocking, TypeScript checks include tests, and Ralph review follows its required task contract.
- AC-009: Focused regression tests and the repository validation sequence pass.

## Constraints

- Preserve existing external contracts except where the audit identified a broken documented contract.
- Prefer minimal cohesive fixes at the shared origin of each defect.
- Preserve unrelated work and do not commit or publish.

## References

- [Implementation plan](plans/implementation.md)
