# The ledger

The ledger is `.ledger/`: searchable project-local operational memory for executing changes. Where the [LLM wiki](../skills/llm-wiki/) accumulates reusable knowledge, the ledger accumulates the plans, specifications, notes, decisions, evidence, assets, progress, outcomes, and retrospectives needed to understand, resume, or audit an undertaking over time.

`.ledger/INDEX.md` maps live tasks for direct reading or search. Closed task bundles move unchanged to `.ledger/history/`, whose index records their terminal status. Repository documentation and tests remain the durable authority for product behavior; the ledger preserves task-specific execution context.

## Use

Check the index before creating a task and continue an existing task when it already owns the undertaking. Use the ledger when work needs to be written down, resumed, handed off, or understood later. Small coherent work need not create a task.

A task directory has only the artifacts that help its continuity. `task.md` holds identity, status, intent, current state, and outcome. Create a plan, specification, note, decision, evidence record, or asset at any useful path inside the task directory when it helps the work; no supporting taxonomy is required and existing bundles remain valid.

Every new task has `retrospective.md`. Keep it concise: it distills what mattered, lessons worth retrieving, and durable improvements without requiring a future reader to replay all operational context. Complete it when the undertaking produces useful learning; do not invent lessons merely to fill it.

## Tools

### `ledger_add`

`ledger_add` creates a timestamped `.ledger/<task-id>/` directory containing only:

```text
.ledger/<task-id>/
  task.md
  retrospective.md
```

It also adds a searchable live-index row. It requires a one-line title and description; an optional lowercase kebab slug overrides the title-derived slug. Existing live and archived IDs are never overwritten. Index updates are atomic and add/close transactions use a project-scoped exclusive lease.

The initial files are deliberately small. `task.md` provides `Status`, `Created`, `Updated`, and intent/current-state/outcome sections. `retrospective.md` provides concise what-mattered, learnings, and improvements sections. Add anything else only when useful.

### `ledger_close`

`ledger_close` archives a live task as `done` or `cancelled`. It updates `Status` in `task.md`, moves the complete bundle to `.ledger/history/`, removes the live-index row, and appends the history row. Source, destination, task, and both indexes are validated before mutation; failures roll back or report a rollback failure.

It does not judge whether work is complete. Read and edit existing ledger files with ordinary repository tools.

## Boundaries

The ledger is not a task database, active-execution checklist, issue tracker mirror, or authority to commit, merge, publish, deploy, or delete work. Do not migrate old bundles merely to match the current scaffold.
