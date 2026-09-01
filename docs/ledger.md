# The ledger

The ledger is a simple project-local convention: `.ledger/` contains one directory per undertaking. It gives task-specific work a stable, searchable home without prescribing a database or artifact schema. The repository owner decides whether that directory is ignored, committed, or shared.

Each task directory is an open-ended bundle. Its root `task.md` identifies and describes the undertaking; skills and operators may add specifications, tickets, plans, decision maps, research, prototypes, evidence, assets, or any other useful files in whatever local shape serves the work. The skill or workflow that creates an artifact owns its format—the ledger does not interpret it.

`.ledger/INDEX.md` maps live tasks for direct reading or search. Closed task bundles move unchanged to `.ledger/history/`, whose index records their terminal status. Repository documentation and tests remain the durable authority for product behavior. The [project wiki](wiki.md) accumulates reusable LLM-derived knowledge and context across tasks; the ledger keeps the operational material for one undertaking.

## Use

Check the index before creating a task and continue an existing task when it already owns the undertaking. Use the ledger when work needs to be written down, resumed, handed off, or understood later. Small coherent work need not create a task.

A task directory has only the artifacts that help its work or continuity. `task.md` holds identity, status, intent, current state, and outcome. Create any supporting file at any useful path inside the bundle; no supporting taxonomy is required. A workflow may define structure for its own artifacts without turning that structure into a ledger-wide contract. Existing bundles remain valid.

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

The ledger does not impose task-database, checklist, issue-tracker, plan, ticket, or dependency-graph semantics. A skill may represent any of those ideas with ordinary files inside its task bundle and remains responsible for their meaning. The ledger is not authority to commit, merge, publish, deploy, or delete work. Do not migrate old bundles merely to match the current scaffold.
