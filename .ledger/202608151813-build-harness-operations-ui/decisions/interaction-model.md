Status: active
Created: 2026-08-15
Updated: 2026-08-15

# Use a branch-scoped active task, gated work items, and one operations hub

## Context

Review and Ralph currently run for long periods with only static widgets, while subagents and Pi Exec have live activity views. Ledger tasks already own task status and Ralph receipts already own run history. Adding a separate todo database would create competing authority, but the session still needs a working-set pointer and task-local implementation decomposition.

## Decision

- Persist the active ledger task as a last-valid, branch-local Pi custom entry containing only schema version, canonical ledger root, and canonical task path. Clearing appends a tombstone entry. The task content and status are never copied into session state.
- Add optional stable `WI-###` work items to `task.md`. Work items decompose implementation; `AC-###` criteria continue to define required behavior. Every non-cancelled work item must be complete before Ralph closure.
- Outside an active Ralph lease, the human or main orchestrator may update work items through normal authorized ledger mutation. During Ralph, only the controller may update them, and completion requires a judge-confirmed executor proposal.
- Provide one interactive operations hub with Ledger, Ralph, and Review views. Existing `/ralph` and `/review` commands remain contextual entrypoints and operational parity rather than independent UI implementations.

## Authority And Provenance

The operator selected all three recommended choices on 2026-08-15 after reviewing the current-state investigation. Existing repository authority establishes the top-level ledger index as the catalog, `task.md` as task status authority, controller-only task mutation during Ralph, and receipts as run authority.

## Alternatives Considered

- A whole-session active pointer is simpler, but it loses the working-set distinction when a Pi session forks or navigates between branches.
- A project-global active pointer is visible across sessions, but concurrent work can overwrite focus and it turns ephemeral attention into shared repository state.
- Advisory work items are easy to maintain, but allow a task to close with known implementation work unchecked.
- Reusing acceptance criteria avoids a new section, but conflates behavioral outcomes with implementation steps and makes planning changes appear to change the contract.
- Plan-only decomposition keeps `task.md` small, but does not provide the todo-like progress and direct task interaction requested by the operator.
- Separate Review, Ralph, and Ledger overlays reduce initial coupling, but duplicate navigation and obscure the relationship between task, run, and review.

## Consequences

- Session branch reconstruction must use Pi's active branch, not all custom entries.
- A stale active pointer must remain visibly stale until cleared or replaced; it must not silently select another task.
- The task parser, controller output schemas, closure checks, receipts, skills, documentation, and UI must understand work items.
- The hub needs typed controller progress subscriptions and shared bounded TUI primitives, while internal agent identities remain private.
- Work-item cancellation requires an explicit reason and is orchestrator/human-owned, not an executor shortcut around incomplete work.

## Limits And Revisit Conditions

Revisit if Pi removes branch-aware custom entries, if teams need explicit cross-session task assignment, or if work-item churn demonstrates that plans are a better authority. A future shared assignment system must be a separately authorized outcome and must not overload the active-task pointer.

## Related Records

- `.ledger/202608151813-build-harness-operations-ui/research/current-state.md`
