---
name: ledger-distill-close-task
description: "Distill and hand off durable outcomes from a ledger iteration or task. Use when asked to close out, finish, pause, block, or stop a .ledger task; promote lessons into repository docs, decisions, runbooks, or reusable skills; create an independent follow-up task; or record why no promotion is warranted. Not for ordinary code cleanup."
---

# Distill and Close a Ledger Task

The task bundle is a self-contained workbench, not automatically permanent project authority. Distill only conclusions with a real future consumer.

1. Read the task Evidence, Review, Retrospective, and existing Distillation; then inspect research Limits, decisions, knowledge, and candidate skills that bear on durable ownership.
2. Classify each durable outcome:
   - product or system contract → the repository's normal documentation/spec location;
   - consequential architectural choice → the repository's ADR/decision location;
   - project vocabulary or operating boundary → handbook or maintainer documentation;
   - repeated error-prone procedure → a host-discoverable project skill or runbook;
   - unresolved bug, risk, or independent outcome → a new `.ledger/<timestamp>-<slug>/task.md` with an explicit dependency when needed;
   - task-specific history with no ongoing consumer → leave it in the task only.
3. Prefer updating the existing authoritative document over creating a parallel copy. Link back to the task only when `.ledger` is committed and that provenance is useful.
4. External wiki, issue-tracker, or service writes require explicit human authority. Record the exact pending promotion or prepare a repository-local draft; never claim publication that was not observed.
5. Record each completed promotion or a substantive no-promotion rationale under `task.md` Distillation.

A valid no-promotion rationale names the lasting owners, for example: implementation tests fully own the bounded invariant and no reusable operational knowledge emerged. `None`, `N/A`, and `Pending` are not distillation.

Task-local candidate skills live under `skills/<slug>/SKILL.md` with `name`, a precise `description: "Use when ..."`, Objective, Prerequisites, Procedure, and Validation. They do not become ambient merely by existing in the ignored ledger; promote them to the repository's configured skill directory only when repeated toil justifies it.

Set `Status: done` only when every acceptance criterion has observed evidence within its limits, dependencies remain done, Blockers is `None.`, all work items are complete or substantively cancelled, review findings are resolved or explicitly bounded, and Retrospective and Distillation are substantive. For a blocked, cancelled, or paused task, preserve crystallized findings and explicit next ownership without manufacturing `done`.

When the operator authorizes archival, call `ledger_close` with `done` or `cancelled`. That tool updates Status if needed, moves the bundle to `.ledger/history/`, and records the terminal status, title, and description in `.ledger/history/index.md`. It does not judge completeness. Keep `.ledger/index.md` as the live path index, not a duplicate status dashboard.
