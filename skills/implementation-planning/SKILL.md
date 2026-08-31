---
name: implementation-planning
description: "Use when settled work has multiple dependent implementation steps whose sequencing, interfaces, or ownership benefit from an explicit plan."
---

# Plan Multi-Step Implementation

Create a plan when it will make execution faster or safer. Direct implementation serves changes that are easier to implement and verify immediately.

## Entry conditions

Planning is appropriate when requirements are settled and one or more are true:

- several substantial steps have real dependencies;
- work will cross sessions or people;
- interfaces must be coordinated before independent implementation;
- migration, rollout, or recovery order matters;
- the operator explicitly asks for a plan.

A clear instruction to implement a bounded change follows the direct path. A ledger task accompanies a plan when durable continuity is valuable.

## Plan for execution, not ceremony

Map the smallest coherent increments that each leave the repository in a useful, verifiable state. Combine setup, tests, documentation, and packaging with the behavior that needs them; Work Item boundaries follow independent outcomes.

Each Work Item should state:

- outcome and exact owned paths;
- dependencies and interfaces that later work relies on;
- implementation steps at the level needed by the executor;
- the cheapest check that can falsify completion.

Root inspection and named checks are the default and need no review metadata. Add a field only when independent review answers a named risk:

```text
Review: one-pass — <named risk>
Review: staged — <named high-cost risk>
```

- `one-pass`: meaningful integration or correctness risk where one fresh review adds value.
- `staged`: security, destructive migration, persistent-data compatibility, difficult rollback, or another explicitly named high-cost risk.

Most Work Items omit the field. A plan explains why any independent review is worth its cost.

## Plan format

For a durable ledger plan:

```markdown
Status: active
Created: YYYY-MM-DD
Updated: YYYY-MM-DD

# Feature implementation plan

## Goal
## Constraints

### WI-001: Outcome
State: open
Dependencies: None
Files:
- Modify: path
Checks:
- command and expected observation
Steps:
1. Concrete action
```

Use `open | active | blocked | complete | cancelled` for Work Item state. Keep implementation progress in the plan only when the plan is serving as shared continuity. Otherwise the working tree and concise status updates are sufficient.

## Detail level

Give a cold-start executor the contractual values, interfaces, and failure behavior it cannot safely infer, but do not reproduce obvious code or every two-minute action. Point to authoritative source and tests instead of pasting large implementations. Avoid placeholders whose resolution would change behavior.

Self-check once for:

- missing dependencies or conflicting interfaces;
- requirements with no owner;
- unnecessary Work Items or machinery;
- a plan larger than the implementation it describes.

Fix issues directly and proceed.

## Review and handoff

Independent plan review serves cases where a wrong plan would be expensive or difficult to detect during incremental implementation. One review begins with proportionality; the root validates findings and edits directly.

Inline execution in the root session is the default. Use `plan-execution` for sequential work. Offer `work-item-orchestration` only when substantial independent Work Items genuinely benefit from context isolation or parallel specialist work. The existence of multiple Work Items does not itself justify subagents.

If the operator already said to implement, completing the plan does not create another approval gate. Begin execution.
