---
name: ledger-plan-task
description: "Use when converting a specified ledger task into a cold-start executable plan and stable acceptance contract."
---

# Plan a Ledger Task

Planning maps settled behavior to the smallest complete implementation sequence. It does not fill semantic gaps with technical defaults.

Create a focused record under `.ledger/<task>/plans/`:

```markdown
Status: active | done
Created: YYYY-MM-DD
Updated: YYYY-MM-DD

# Implementation plan

## Outcome
## Current-System Evidence
## Change Surfaces
## Sequence
## Acceptance And Backpressure
## Risks And Failure Modes
## Integration Points
## Rollback Or Recovery
## Related Records
```

Plan from inspected source. Name concrete owner files and interfaces only when evidence establishes them. Map every task acceptance criterion to production behavior and a falsifying check. Separate implementation behavior from deployment, external action, and documentation/process evidence; the latter remain human-owned unless explicitly authorized.

Use one task for one coherent outcome. If a plan reveals independent outcomes with different authority or acceptance, create separate timestamped tasks and connect them with `Depends-On`. Do not create child tickets or a second task list inside the bundle.

Before declaring readiness, ensure:

- every execution-changing assumption is record-backed or user-ratified;
- dependencies name canonical task roots and are `done`;
- References are task-local and active under their record lifecycle;
- Scope and Non-goals establish a reviewable perimeter;
- stable `AC-###` criteria cover success and important failure boundaries;
- Blockers is honestly `None.`;
- a fresh executor can choose implementation mechanics without re-deriving product meaning.

Link the active plan from `task.md`, then run `ralph inspect .ledger/<task>/task.md`. Do not start Ralph merely because the graph compiles; implementation still requires operator authorization.
