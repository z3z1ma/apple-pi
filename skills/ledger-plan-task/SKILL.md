---
name: ledger-plan-task
description: "Plan implementation for a shaped .ledger task whose semantics are settled. Use when asked to write an implementation plan, identify source-backed change surfaces and sequence, map acceptance criteria to falsifying checks, assess risks and integration or recovery, or check whether a task is ready for /skill:pi-ralph. Not for inventing behavior or executing the task."
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

Plan from inspected source. Name concrete owner files and interfaces only when evidence establishes them. Classify every acceptance criterion as production behavior, an invariant, runtime or deployment evidence, or documentation or process evidence. Map production behavior and invariants to concrete change surfaces and falsifying checks; keep runtime, deployment, documentation, and process evidence human-owned unless explicitly authorized.

Use one task for one coherent outcome. If a plan reveals independent outcomes with different authority or acceptance, create separate timestamped tasks and connect them with `Depends-On`. Do not create child tickets or a second task list inside the bundle.

Before declaring readiness, ensure:

- every execution-changing assumption is record-backed or user-ratified;
- dependencies name canonical task roots and are `done`;
- every referenced task-local record is in an accepted lifecycle state, while ordinary repository source references are concrete and current;
- Scope and Non-goals establish a reviewable perimeter;
- stable `AC-###` criteria cover success and important failure boundaries;
- Blockers is honestly `None.`;
- a fresh executor can choose implementation mechanics without re-deriving product meaning.

Link the active plan from `task.md`, then read the task and governing records with ordinary repository tools. Do not start `/skill:pi-ralph` merely because the records look complete; implementation still requires operator authorization.
