---
name: ledger-distill-close-task
description: "Use when closing or pausing a ledger task and routing its durable lessons into the repository's real documentation, decisions, or reusable skills."
---

# Distill and Close a Ledger Task

The task bundle is a self-contained workbench, not automatically permanent project authority. Distill only conclusions with a real future consumer.

1. Read the task Evidence, independent Review, Judgment, Retrospective, research limits, decisions, knowledge, and candidate skills.
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

Closure still requires Ralph's evidence and review gates. For a blocked or stopped task, preserve crystallized findings and explicit next ownership without manufacturing `done`. Keep `.ledger/README.md` as a path index, not a duplicate status dashboard.
