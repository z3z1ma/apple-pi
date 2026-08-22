Status: complete
Created: 2026-08-21
Updated: 2026-08-21

# pi-tasks baseline

## Source and limits

Inspected <https://github.com/tintinweb/pi-tasks> at commit `86a559c` (`v0.8.0`). The source is MIT licensed with original notice `Copyright (c) 2026 tintinweb`. This record summarizes the baseline; implementation must still compare copied files with local APIs and preserve attribution in `THIRD_PARTY_NOTICES.md`.

## Valuable baseline behavior

- Seven Claude Code-compatible tools: `TaskCreate`, `TaskList`, `TaskGet`, `TaskUpdate`, `TaskOutput`, `TaskStop`, and `TaskExecute`.
- Persistent above-editor widget with task counts, pending/in-progress/completed states, blockers, animated active-task state, elapsed time, and token counts.
- `/tasks` manager for viewing, creating, starting, completing, deleting, clearing, and configuring tasks.
- Dependency graph with bidirectional `blocks` and `blockedBy` edges.
- Memory, session-file, project-file, named, and explicit-path storage modes with atomic writes and file locking.
- Session startup, reload, resume, new-session, and fork handling, including reattaching active agent tasks.
- Optional turn-based auto-clear and transient reminder injection.
- Background subagent execution and optional dependency auto-cascade.
- Data-only global and trusted project configuration for storage and widget presentation.
- Broad behavioral tests covering storage, concurrency, lifecycle, reminders, widget rendering, command flows, and subagent integration.

## Baseline structure

- `src/index.ts`: tools, command, lifecycle, store selection, reminders, and subagent orchestration; this is overly coupled for direct wholesale retention.
- `src/task-store.ts`: task persistence, normalization, locking, CRUD, and dependency maintenance.
- `src/types.ts`: task and process contracts.
- `src/task-sort.ts`: pure display sorting.
- `src/auto-clear.ts`: turn-based cleanup state.
- `src/reminder-cadence.ts`: pure reminder cadence.
- `src/tasks-config.ts`: data-only config merge and persistence.
- `src/ui/task-widget.ts`: persistent widget rendering.
- `src/ui/settings-menu.ts`: settings TUI.
- `src/process-tracker.ts`: generic child-process tracking.

## Integration differences in apple-pi

- apple-pi already owns subagents, their lifecycle events, FleetView, result retrieval, steering, and stopping. The reference's optional external subagent RPC and fallback path should not become a second agent boundary.
- apple-pi's backlog is branch-aware session parking in Pi JSONL; it is not active execution state.
- apple-pi's Ledger is durable repository authority and acceptance evidence; it is not a runtime to-do database.
- apple-pi already has an input-card status system and multiple above/below-editor widget owners. New UI must preserve focus and composition conventions.
- Package entrypoints, published files, TypeScript includes, Vitest includes, loader assertions, README, docs, and boundaries are explicit release surfaces.

## Candidate pruning

- Do not import `process-tracker.ts` unless a real background-process producer exists; the reference does not wire `track()` in production.
- Do not keep a standalone-mode fallback for absent subagents because apple-pi ships the owned subagent runtime in the same package.
- Do not preserve external RPC solely for compatibility; use the narrowest existing in-package integration seam.
- Do not copy every sort/configuration knob before the core interaction proves which ones are useful.
- Do not accept self-dependencies, dangling edges, or cycles merely because the reference warns about them; decide whether apple-pi should reject invalid execution graphs.

## Product choices still requiring ratification

1. Whether to-dos coexist with backlog and Ledger, replace backlog, or become a UI over both.
2. Default persistence and whether shared project lists are a first-release requirement.
3. Whether agent execution and dependency auto-cascade are core first-release behavior.
4. Whether tool names prioritize Claude Code compatibility (`TaskCreate`, etc.) or apple-pi naming conventions.
