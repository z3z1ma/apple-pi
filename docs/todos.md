# To-dos

To-dos are the first-class, active-execution checklist. They complement—not replace—the [session backlog](backlog.md) and [Ledger](ledger.md).

## Authority and promotion

The three layers have distinct owners:

- **Backlog** parks worthwhile ideas outside current scope. It is session-branch state and its human manager owns editing, deletion, and order.
- **To-dos** track active, disposable execution steps. Completion is not durable acceptance evidence.
- **Ledger** owns consequential project intent, acceptance criteria, decisions, and evidence.

Promote in order, never by silently reclassifying state:

1. Backlog → to-do: create the to-do, then call `backlog_take` only after creation succeeds.
2. Backlog → Ledger: agree the promotion, call `ledger_add`, then `backlog_take` only after success.
3. To-do → Ledger: agree the promotion, call `ledger_add`, then delete the original to-do only after success—unless it remains an unambiguous execution step under the new Ledger task.

A Ledger task may use to-dos as its ephemeral checklist, but a completed to-do does not prove Ledger acceptance.

## Model tools

All to-do tools are lowercase native tools; there are no `Task*` compatibility aliases. IDs are monotonic positive numbers within a list.

| Tool | Inputs | Effect |
| --- | --- | --- |
| `todo_create` | `title` (1–160 chars), optional `description` (≤2,000), `active_form` (≤160), `blocked_by` (positive integer IDs), `agent_type` (≤80), `profile` (≤80) | Creates an `open` to-do. |
| `todo_list` | none | Lists the current checklist. |
| `todo_get` | `id` | Returns one to-do, including derived `blocked` and `blocks`. |
| `todo_update` | `id`, optional `status` (`open`, `active`, `completed`) and the same mutable fields as create | Updates an unmanaged to-do. Empty optional text clears its corresponding optional field. |
| `todo_delete` | `id` | Deletes an unmanaged to-do and removes its dependency from unmanaged dependents. |
| `todo_execute` | `ids` (non-empty positive integer array), optional `context` (≤4,000 chars) | Starts eligible agent-backed to-dos through apple-pi's managed subagent service. |
| `todo_output` | `id`, optional `wait` | Shows stored output and execution state; `wait` waits only for a locally owned run. |
| `todo_stop` | `id` | Stops a locally owned managed execution. |

To-do records have statuses `open`, `active`, and `completed`. “Blocked” is derived only when an `open` to-do has an incomplete prerequisite; it is not stored status. `blockedBy` is the only persisted edge direction; `blocks` is derived. The implementation rejects missing prerequisites, self-dependencies, duplicate edges, cycles, and making an `active` to-do while a prerequisite remains incomplete. Invalid mutations are atomic: the previous list remains intact. A managed execution cannot be edited or deleted; its run identity controls settlement so late workers cannot settle a newer attempt or branch.

## `/todos` and the widget

`/todos` opens the interactive manager (TUI only). It provides create, edit, start, reopen, complete, blocker editing, execute, output, stop, confirmed stale-claim recovery, delete, clear completed, clear all, and settings actions. Create and edit include title, description, active form, agent type, and profile, with empty optional fields clearing them. Its keys are: Up/Down or `j`/`k` select; `c` create; `e` edit those fields; `b` edit blocker IDs; Enter/Space starts an unblocked open item, completes an active item, or reopens a completed item; `r` reopens a completed item or requests shared-project recovery for an executing one; `t` executes an eligible open agent-backed item or stops an executing one; `o` shows output; `d` deletes; `v` completes a non-completed selection; `x` clears completed items; `X` clears all; `s` opens settings; Escape, Ctrl+C, or `q` closes. It requires confirmation for deletion, clearing, and stale recovery. Clear-all refuses when any managed execution exists. Shared-project stale recovery is available only after a confirmation and a locked recheck that the same run ID is still claimed and its owner PID is positively dead; unknown liveness fails closed.

The above-editor widget shows total/completed/active/open counts, completed items, manual active items, derived blockers, and managed-execution activity. A managed row includes a spinner, active form or title, agent type, elapsed time, token totals, turn/tool counts, and current activity when available. `todos N` in the input-card status strip is the count of non-completed to-dos and disappears at zero. Widget settings choose ID/active/recent sorting, completion collapse, and 1–100 visible rows.

## Reminders and cleanup

When enabled, reminders are transient context entries (`apple-pi.todos-reminder`), not saved prompt authority. They become due after two idle turns with an active to-do or four otherwise, reset after any to-do tool call, and show at most ten actionable items / 1,200 characters. They explicitly remind the model that this checklist is not durable Ledger authority.

Auto-clear is session-only: `never` retains completed rows; `on_list_complete` clears a fully completed list after four turns; `on_todo_complete` clears each completed row after four turns. Completed batches may also retire before a new to-do is created after a managed run ends. Auto-clear never mutates a shared project list.

## Storage, trust, and recovery

Default storage is session state. Complete snapshots are appended under Pi custom entry `apple-pi.todos-state`; the newest valid snapshot restores from the selected session branch on session start/tree navigation. Branches therefore retain their own snapshots. Locally owned or positively dead interrupted session executions reopen with an error; a live foreign process claim remains intact.

Project storage is an opt-in trusted-project mode at `<cwd>/.pi/todos/shared.json`. It is shared across sessions and processes, but storage-mode changes take effect only at the next session start and do not migrate lists. Each mutation re-reads while holding the shared project-scoped SQLite lease, writes a uniquely named temporary file, and atomically renames it. The lease is an operating-system-backed SQLite write transaction, so ownership is released automatically when a process exits and recovery never deletes another process's lock.

Data-only defaults are read from `$PI_CODING_AGENT_DIR/todos.json`. Trusted projects may override them in `<cwd>/.pi/todos.json`; untrusted project files are ignored. Accepted keys are `storage` (`session` or `project`), `autoCascade`, `autoClearCompleted` (`never`, `on_list_complete`, `on_todo_complete`), `reminders`, `sortOrder` (`id`, `active`, `recent`), `collapseCompleted`, and `maxVisible` (integer 1–100). Project settings are sparse: `/todos` persists only values that differ from the effective global defaults and removes an override when reset equal, so omitted keys continue to inherit the global/default value. Project settings are written only by `/todos` in a trusted project.

## Managed execution

An executable to-do needs `agent_type`; `profile` is optional. Execution uses the owned managed-subagent service and creates an ordinary public `AgentRecord`, visible in `/agents` and FleetView—not a second runtime, process tracker, transcript, or RPC path. It atomically claims the to-do before launch, records the agent ID, and settles only if both to-do and run IDs still match. Successful runs complete the to-do and retain bounded result output; failures reopen it with a bounded error. Stop applies only to a locally owned attached run.

With `autoCascade`, a successful prerequisite can start each now-unblocked, open, agent-backed dependent through the same claim path. It never starts blocked, manual, already claimed, or failed-to-launch work.
