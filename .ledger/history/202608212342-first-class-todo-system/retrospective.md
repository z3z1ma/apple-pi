Status: complete
Created: 2026-08-21
Updated: 2026-08-21

# Retrospective

## Summary

Adapted pi-tasks into an apple-pi-owned active to-do layer with native tools, a complete TUI, branch-aware and shared persistence, safe dependency/execution state, and owned public subagent runs.

## What Worked

- Starting from a strong MIT reference accelerated the task model, widget, manager, reminder, cleanup, and concurrency design.
- Keeping backlog, to-dos, and Ledger distinct prevented the runtime checklist from becoming competing durable authority.
- Incremental persistence and execution reviews caught branch contamination, stale-lock races, managed bulk-delete bypasses, and early claim release before integration.

## What Could Improve

- The first core implementation was too compressed and under-tested. Exact state and failure contracts should have been fixed before delegation.
- Formatting broad existing files created avoidable diff churn and had to be reconstructed into narrow changes.

## Learnings

- Branch-aware async work must stop and settle during `session_before_tree`, `session_before_fork`, and `session_before_switch`; post-navigation cleanup is too late because session-entry writes target the new branch.
- A shared-file execution claim needs both atomic lock-scoped mutation and persisted owner liveness identity. Recovery must recheck the same run under lock and fail closed on unknown liveness.
- Programmatic subagent features should expose one catalog-level service over the owned `AgentManager`, so FleetView, lifecycle, queueing, and transcripts remain one reality.

## Improvements

The durable lifecycle, authority, storage, and integration contracts now live in `docs/todos.md`, `docs/boundaries.md`, and the root workflow prompt. Focused regressions cover graph safety, branch restoration, snapshot failure, settings trust, execution state, cascade, manager mapping, and UI rendering.
