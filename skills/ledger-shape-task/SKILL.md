---
name: ledger-shape-task
description: "Use when turning non-trivial work into one self-contained .ledger task bundle before implementation."
---

# Shape a Ledger Task

Stay in shaping: inspect source and existing `.ledger` tasks, clarify execution-changing ambiguity, and write only ledger records. Do not implement in the same turn that first crystallizes a non-trivial contract.

## Find the owner

Search `.ledger/README.md`, open and terminal task roots, and relevant repository authority. Extend an existing owner when it already covers the outcome. Create a task only for real non-trivial work with an observable consequence.

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

Do not create empty category directories or ceremonial records. Ordinary References stay inside this task bundle. Cross-task edges use only `Depends-On: .ledger/<other-task>/task.md`; the dependency must eventually be `done` before execution.

## Root task contract

`task.md` begins with canonical `Status`, `Created`, and `Updated` headers and optional `Depends-On`. It has exactly one title and these sections:

- Scope
- Non-goals
- Acceptance Criteria, with stable `AC-001` identifiers
- References
- Assumptions, each record-backed, user-ratified, or blocked
- Journal
- Blockers
- Evidence
- Review
- Retrospective
- Distillation

Use `None.` for Blockers only after inspection supports it. Leave Evidence, Review, Retrospective, and Distillation as `Pending.` until observed work supplies them. A cold-start executor must be able to proceed without inventing behavior, authority, side effects, or acceptance.

Use `ledger-research-task`, `ledger-specify-task`, and `ledger-plan-task` for the corresponding shaping phases. Validate readiness with `ralph inspect`; inspection is not implementation authorization.
