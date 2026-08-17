---
name: ledger-shape-task
description: "Create or refine a self-contained .ledger task bundle before implementation. Use when asked to create a ledger task, shape or scope non-trivial work, define acceptance criteria, capture assumptions or blockers, add dependencies or work items, or make a task ready for /skill:pi-ralph. Not for research details, implementation planning, or executing the task."
---

# Shape a Ledger Task

Stay in shaping: inspect source and existing `.ledger` tasks, clarify execution-changing ambiguity, and write only ledger records. Do not implement in the same turn that first crystallizes a non-trivial contract.

## Find the owner

Search `.ledger/README.md`, all indexed task roots—especially `open`, `active`, and `blocked` tasks—and relevant repository authority. Extend an existing owner when it already covers the outcome. Create a task only for real non-trivial work with an observable consequence.

A new task directory is `.ledger/YYYYMMDDhhmm-lowercase-kebab-slug/`. Use a valid current calendar minute; if it collides, choose a more specific slug. Create exactly one executable root named `task.md` and add its project-relative path to `.ledger/README.md`. The index is navigation only and must not duplicate status.

Use task-local directories only when consumed by this task:

```text
specs/       behavioral contracts
decisions/   consequential choices and tradeoffs
research/    sourced investigations and null results
plans/       implementation sequence and integration points
evidence/    observations that outlive one routine check
knowledge/   task-local vocabulary and reusable findings
skills/      task-local candidate procedures
```

Do not create empty category directories or ceremonial records. Task-local supporting records stay inside their owning bundle; `task.md` References may also name ordinary repository source paths. Cross-task edges use only `Depends-On: .ledger/<other-task>/task.md`; every dependency must be indexed and `done` before execution.

## Root task contract

For a new bundle, `task.md` begins with `Status: open`, canonical `Created` and `Updated` headers, and optional `Depends-On`; the task ID's date must match `Created`. Existing bundles retain their valid current status. The file has exactly one level-one title and these sections:

- Scope
- Non-goals
- Acceptance Criteria, with stable `AC-001` identifiers
- Work Items (optional; only between Acceptance Criteria and References, with canonical `WI-###` rows)
- References
- Assumptions, each record-backed, user-ratified, or blocked
- Journal
- Blockers
- Evidence
- Review
- Retrospective
- Distillation

Use `None.` for Blockers only after inspection supports it. Leave Evidence, Review, Retrospective, and Distillation as `Pending.` until observed work supplies them. A cold-start executor must be able to proceed without inventing behavior, authority, side effects, or acceptance.

Use `ledger-research-task`, `ledger-specify-task`, and `ledger-plan-task` for the corresponding shaping phases. Validate readiness by inspecting the task with the `ledger` tool; inspection is not implementation authorization.
