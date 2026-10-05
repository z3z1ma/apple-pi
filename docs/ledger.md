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
  history.json
```

It also adds a searchable live-index row. It requires a one-line title and description; an optional lowercase kebab slug overrides the title-derived slug. Existing live and archived IDs are never overwritten. Index updates are atomic and add/status transactions use a project-scoped exclusive lease.

The initial files are deliberately small. `task.md` provides `Status`, `Created`, `Updated`, and intent/current-state/outcome sections. `retrospective.md` provides concise what-mattered, learnings, and improvements sections. `history.json` is described under [History](#history). Add anything else only when useful.

## Lifecycle

A task has one status, kept in `task.md` and on its index row:

| Status | Meaning |
| --- | --- |
| `planning` | Intent, approach, or acceptance criteria are not yet settled. `ledger_add` starts every task here. |
| `ready` | Intent, approach, and acceptance criteria are settled; implementation has not started. |
| `in-progress` | Implementation has started. |
| `done` / `cancelled` | Terminal; the task is archived to `.ledger/history/`. |

Live index rows read `` - `.ledger/<id>/task.md` — <status> — <title> — <description> ``, so `.ledger/INDEX.md` shows how much work is in planning and in progress. Count with `grep -c ' — planning — ' .ledger/INDEX.md`. Any live status may move to any other; the ledger does not enforce an order.

### `ledger_status`

`ledger_status` moves a live task to a new status. A live status (`planning`, `ready`, `in-progress`) updates `Status` in `task.md` and the status on the live-index row, adding it to a row that has none. `done` or `cancelled` archives the task: it updates `Status` in `task.md`, moves the complete bundle to `.ledger/history/`, removes the live-index row, and appends the history row. Archive only after edits to the bundle are written and committed; an archive issued in the same batch as those edits moves the bundle out from under them. Source, destination, task, and both indexes are validated before mutation; failures roll back or report a rollback failure. In a root session with open notebook learnings, the first `done` or `cancelled` call for a task is held once so they can be placed while the retrospective is still live (see [context](context.md)).

It does not judge whether work is complete. Read and edit existing ledger files with ordinary repository tools.

## History

The ledger extension keeps `history.json` in each task bundle so a finished task can later be studied with the sessions and commits behind it. It holds pointers only:

```json
{
  "sessions": [{ "id": "<Pi session id>", "linkedAt": "<ISO time>", "via": "ledger_add" }],
  "commits": [{ "event": "in-progress", "at": "<ISO time>", "repository": ".", "commit": "<HEAD>" }]
}
```

- **Sessions.** A Pi session is linked the first time it calls `ledger_add` or `ledger_status` for the task, or changes a file inside the task's live bundle. `via` records which (`ledger_add`, `ledger_status`, or `edit`). Each session appears once.
  - A `write` or `edit` links through its path, resolved as those tools resolve it (`~/`, `file://`, and `@` included). The ledger is the nearest `.ledger/<task-id>/` holding the file, so a session working in a repository below a parent-directory ledger links to that ledger.
  - A `bash` or `pi_exec` call links when, after it, a live bundle has a file added, removed, or changed (by modification time, status-change time, or size) compared with just before it. Only bundles under the session's directory and its ancestors' `.ledger/` directories are compared, and `history.json` itself is ignored.
  - Only sessions with a session file (a persisted transcript) link. Sessions without one, such as Pi Exec workers and in-memory children, link nothing, since their IDs would point at no transcript; their status changes still record commits.
- **Commits.** When `ledger_status` moves the task to `in-progress`, `done`, or `cancelled`, it records `HEAD` with the event and time. The ledger root is the session's directory. When that directory is inside a git repository, the entry names the repository's top level relative to the ledger root (`.` when the ledger root is the top level). Otherwise each git repository directly below the ledger root (a parent-directory ledger) gets its own entry, named by its directory; deeper repositories are not scanned, and every such repository is recorded whether or not the task touched it. A repository without commits, or a ledger outside git, records no entry; the session still links.

The close entry and link are written before the bundle moves to `.ledger/history/`, so the archive keeps `history.json`. Updates are atomic and share the add/status lease. A link waits while another ledger transaction holds the lease, until it is free or the session aborts. A link that was waiting when the task closed is written into the archived bundle.

Nothing is derived when it is captured: turn counts, tokens, costs, and other measures come later from the transcripts, so a better measure applies to every recorded task. Transcripts stay in the local Pi session store. A shared `.ledger/` carries only session IDs and commit hashes, not transcripts.

## Boundaries

The ledger does not impose task-database, checklist, issue-tracker, plan, ticket, or dependency-graph semantics. A skill may represent any of those ideas with ordinary files inside its task bundle and remains responsible for their meaning. The ledger is not authority to commit, merge, publish, deploy, or delete work. Do not migrate old bundles merely to match the current scaffold.
