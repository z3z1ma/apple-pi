---
name: ledger-specify-task
description: "Specify behavior and decisions for a .ledger task before implementation planning. Use when asked to write or refine a task-local spec, define required and failure behavior or scenarios, record a consequential product or architecture decision with alternatives, or establish shared vocabulary and constraints. Not for unresolved research or implementation mechanics."
---

# Specify a Ledger Task

Turn ratified meaning into regeneration-grade task-local authority. Inspect research, source, existing repository docs, and the owning task before writing.

## Specifications

Create a focused record under `specs/` when behavior must be shared across iterations or implementation surfaces. Use:

```markdown
Status: draft | active | superseded
Created: YYYY-MM-DD
Updated: YYYY-MM-DD

# Behavioral surface

## Purpose And Authority
## Actors And Boundaries
## Required Behavior
## Error And Failure Behavior
## Given-When-Then Scenarios
## Acceptance Mapping
## Exclusions
## Assumptions And Provenance
## Related Records
```

Use RFC 2119 terms deliberately. Specify observable outcomes, lifecycle, side effects, permissions, empty/error states, and invariants—not implementation trivia. Split independent workflows or side-effect families rather than producing one feature-wide omnibus spec. Only `active` specs govern execution.

## Decisions

Create a record under `decisions/` for a consequential, surprising, or costly-to-reverse choice:

```markdown
Status: active | superseded
Created: YYYY-MM-DD
Updated: YYYY-MM-DD

# Decision

## Context
## Decision
## Authority And Provenance
## Alternatives Considered
## Consequences
## Limits And Revisit Conditions
## Related Records
```

Steelmanning rejected alternatives is required. A changed accepted decision is superseded, not silently rewritten.

## Knowledge

Use `knowledge/` for task-local vocabulary, conventions, or constraints needed repeatedly inside this task. Status is `active`. Do not copy general project documentation into the task. At closure, `ledger-distill-close-task` decides whether the finding belongs in durable repository documentation.

Update `task.md` References to the smallest records that govern execution. Every execution-relevant assumption must be record-backed, explicitly user-ratified, or a blocker. Do not turn polished prose into false authority.
