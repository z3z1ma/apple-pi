---
name: ledger-shape-task
description: "Create or refine a self-contained .ledger task bundle before implementation. Use when asked to create a ledger task, shape or scope non-trivial work, define acceptance criteria, capture assumptions or blockers, add dependencies or work items, or make a task ready for /skill:pi-ralph. Not for research details, implementation planning, or executing the task."
---

# Shape a Ledger Task

Stay in shaping: inspect source and existing `.ledger` tasks, clarify execution-changing ambiguity, and write only ledger records. Do not implement in the same turn that first crystallizes a non-trivial contract.

## Find the owner

Search `.ledger/index.md`, live task roots—especially `open`, `active`, and `blocked` tasks—and relevant repository authority. Check `.ledger/history/index.md` before recreating a closed outcome. Extend an existing owner when it already covers the outcome. Create a task only for real non-trivial work with an observable consequence.

For a new task, call `ledger_scaffold` with a title, a one-line description, and optional lowercase kebab slug. It creates `.ledger/YYYYMMDDhhmm-lowercase-kebab-slug/`, exactly one executable root named `task.md`, the standard supporting directories, and the project-relative index row in `.ledger/index.md`. If the timestamped slug collides, choose a more specific slug and call it again. The live index stores title and description for search and must not duplicate status.

The scaffold creates these directories, but add records only when consumed by this task:

```text
specs/       behavioral contracts
decisions/   consequential choices and tradeoffs
research/    sourced investigations and null results
plans/       implementation sequence and integration points
evidence/    observations that outlive one routine check
knowledge/   task-local vocabulary and reusable findings
skills/      task-local candidate procedures
```

Do not create ceremonial records merely because their scaffold directories exist. Task-local supporting records stay inside their owning bundle; `task.md` References may also name ordinary repository source paths. Cross-task edges use only `Depends-On: .ledger/<other-task>/task.md`. Resolve that identity at the live path if present, otherwise at `.ledger/history/<other-task>/task.md`. A dependency is ready when the resolved task exists and its Status is `done`.

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

Use `ledger-research-task`, `ledger-specify-task`, and `ledger-plan-task` for the corresponding shaping phases. Validate readiness by reading the completed task and its governing records with ordinary repository tools; inspection is not implementation authorization.
