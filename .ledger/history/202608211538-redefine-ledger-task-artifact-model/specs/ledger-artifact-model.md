Status: active
Created: 2026-08-21
Updated: 2026-08-21

# Ledger Artifact Model

## Purpose and Authority

This specification defines the current artifact ontology for newly created Ledger task bundles. It implements the operator-approved design recorded in the governing task. It replaces the prior model in which `task.md` combined intent, execution tracking, evidence, review, retrospective, and distillation.

The specification governs new scaffolds and active workflow guidance. Archived task bundles are historical records and are not migration targets.

## Actors and Boundaries

- The operator establishes or ratifies task intent and consequential product semantics.
- Task shaping crystallizes that intent in `task.md`.
- A specification defines required system behavior when a meaningful code or behavioral change needs a contract beyond task intent.
- A plan translates the task and applicable specifications into executable work and owns progress against that work.
- Research investigates unresolved questions without authorizing product semantics.
- Decisions record consequential choices and their provenance.
- Evidence records what was observed, how, where, and with what limits.
- The retrospective reviews the undertaking and connects its learnings to improvements in durable project owners.

Ledger remains a task-local workbench. It does not replace repository documentation, configured skills, tests, runbooks, ADRs, issue trackers, or production state.

## Bundle Layout

`ledger_add` MUST create this structure for every new task:

```text
.ledger/<task-id>/
  task.md
  retrospective.md
  specs/
  plans/
  research/
  decisions/
  evidence/
```

The scaffold MUST NOT create `knowledge/` or `skills/`. Skills belong in package, trusted-project, personal, or other configured skill locations. Durable project knowledge belongs in the repository owner that will change future behavior.

The standard directories MAY remain empty when the task has no concrete artifact of that type. Their presence identifies the supported ontology and gives evidence a consistent storage boundary from task creation onward.

Every Markdown supporting record begins with `Status`, `Created`, and `Updated`. Allowed statuses are:

- specification: `draft | active | superseded`;
- plan: `draft | active | complete | superseded`;
- research: `active | complete | superseded`;
- decision: `active | superseded`;
- evidence: `recorded`; and
- retrospective: `pending | complete`.

Only active specifications and decisions govern current semantics. An active plan owns current execution; complete and superseded plans do not. Active or complete research retains its stated findings and limits but never becomes semantic authority. A superseded record links to its replacement. Evidence remains an observation rather than becoming authority.

## Task Contract

`task.md` is the durable statement of why an undertaking exists and what outcome it seeks. It is the bundle root and the authority for task identity and acceptance, not a lifecycle dashboard.

A newly scaffolded task MUST use this ordered template:

```markdown
Status: open
Created: YYYY-MM-DD
Updated: YYYY-MM-DD

# Task title

## Intent

Pending shaping.

## Outcome

Pending shaping.

## Scope

Pending shaping.

## Non-goals

- Pending shaping.

## Acceptance Criteria

- AC-001: Pending shaping.

## Constraints

- Pending shaping.

## References

- Pending shaping.
```

`Depends-On: .ledger/<task-id>/task.md` is an optional header immediately after `Updated` when another task gates the outcome. Shaping MUST replace every placeholder before planning or execution begins.

`task.md` MUST NOT contain canonical sections for Work Items, Assumptions, Journal, Blockers, Evidence, Review, Retrospective, or Distillation.

Task status remains `open | active | blocked | done | cancelled`. When a task is blocked, the blocking condition MUST be represented in the artifact that owns it—normally a plan, research record, decision need, or dependency—and linked from `References`. Status communicates task state without turning the root into a progress log.

Acceptance Criteria define observable completion conditions for the intended outcome. Completing plan work does not itself prove an Acceptance Criterion.

`Constraints` owns operator-ratified task-level restrictions and settled conditions. An execution-changing assumption that is not operator-ratified MUST be investigated in research, settled in a decision or specification, or remain blocking; `task.md` links the owning record from `References` rather than carrying an assumptions log.

## Specification Contract

A specification is optional. It is required when meaningful code or behavioral semantics must be fixed independently of implementation.

A specification defines actors and boundaries, required behavior, error and failure behavior, scenarios or invariants, exclusions, assumptions with provenance, and mappings to task Acceptance Criteria. It MUST NOT own implementation progress.

Research-only, documentation-only, operational, or sufficiently bounded tasks MAY proceed without a specification when `task.md` contains an unambiguous intent and outcome.

## Plan Contract

A plan is the execution instrument for accomplishing a task. It owns:

- work-item decomposition and identifiers;
- dependencies and sequencing;
- implementation surfaces and integration points;
- verification procedures;
- the current state of execution;
- completed, cancelled, blocked, or replanned work; and
- links to evidence produced while executing the plan.

Workflow guidance MUST update progress in the active plan rather than mirror a canonical Work Item checklist in `task.md`.

A plan may change as execution reveals new implementation facts. It may not silently change task intent or specified behavior. Such changes return to task shaping, specification, research, or decision work as appropriate.

## Research Contract

A research record owns one question or hypothesis and the analytical provenance of investigating it. It records motivation, dated sources and methods, analysis, findings including null or contradictory results, conclusions, limits, and related records.

Research and evidence have different provenance. Research owns inquiry, source citation, interpretation, and synthesis. Evidence owns discrete observations produced to validate a task claim, specified behavior, implementation, environment, or review assessment. Bibliographic citations and source analysis stay in research. Executed experiments or environment observations that must support acceptance are recorded in `evidence/` and linked from research. The same observation MUST NOT be copied into both locations.

Research informs tasks, specifications, plans, and decisions. Its conclusions are not authority to make a product choice.

## Decision Contract

A decision records a consequential choice, its authority and provenance, viable alternatives, consequences, limits, revisit conditions, and related records. Only active decisions govern current execution.

## Evidence Contract

`evidence/` is the task's validation laboratory notebook and captured-artifact boundary. All routine and exceptional observations used to validate task acceptance, specified behavior, implementation, environments, or reviews belong there; no class of such evidence is written into `task.md` merely because it is small or routine.

An evidence note MUST identify:

- the purpose, claim, or Acceptance Criterion investigated;
- the exact procedure;
- observed results, including failures and surprises; and
- limits—what the observation does not establish.

It MUST also identify the relevant source revision, configuration, runtime, deployment, or test environment when those conditions affect interpretation. Linked or embedded logs, screenshots, command output, reports, or captured data are included when they are part of the observation.

Evidence may include test and lint runs, package checks, deployed-environment exercises, screenshots, benchmark output, review reports, and review dispositions. Binary or machine-generated artifacts MAY live below `evidence/` when safe and useful.

Evidence records observations with provenance. It MUST NOT be treated as semantic authority, task progress, or proof beyond its documented procedure and limits. Failed and contradictory observations remain valid evidence.

Review output belongs under `evidence/` because review is a provenance-bearing assessment. Remediation progress resulting from review belongs in the active plan.

## Retrospective Contract

Every scaffolded task has one top-level `retrospective.md`. It replaces both the former `Retrospective` and `Distillation` sections and MUST use this ordered template:

```markdown
Status: pending
Created: YYYY-MM-DD
Updated: YYYY-MM-DD

# Retrospective

## Summary

Pending completion of the undertaking.

## What Worked

Pending completion of the undertaking.

## What Could Improve

Pending completion of the undertaking.

## Learnings

Pending completion of the undertaking.

## Improvements

Pending completion of the undertaking.
```

Closure replaces every placeholder and sets `Status: complete`. The sections mean:

- `Summary`: how the undertaking unfolded relative to its intent and plan;
- `What Worked`: practices and decisions worth retaining;
- `What Could Improve`: friction, errors, surprises, and avoidable cost;
- `Learnings`: generalizable conclusions supported by the task's experience and evidence; and
- `Improvements`: concrete changes made to durable project owners, or links to independently owned follow-up tasks.

The retrospective synthesizes rather than duplicates evidence. Its improvement section MUST identify actual owner changes such as `AGENTS.md`, documentation, tests, runbooks, configured skills, or a new task. A substantive explanation that no durable promotion was warranted is acceptable.

A task MUST NOT be marked `done` until all of the following are true:

- every dependency resolves to a `done` task;
- no referenced research, decision need, plan, or dependency still blocks the outcome;
- no active plan remains, and every plan for the outcome is `complete` or `superseded` with its work complete or substantively cancelled with a rationale;
- every Acceptance Criterion has adequate supporting evidence under `evidence/` with applicable limits;
- every review finding and resulting remediation is resolved, rejected with evidence, or explicitly bounded with rationale, owner, and revisit condition; and
- `retrospective.md` is complete.

A blocked or paused undertaking retains an honest non-terminal task status and the owning artifact records what remains.

## Lifecycle Behavior

Task shaping MUST shape `task.md` first. It introduces a specification only when behavioral semantics require one.

Implementation planning MUST create or update an active plan and place Work Items and progress there.

Execution and orchestration MUST update the plan for progress and write observed checks, environment exercises, and review material under `evidence/`.

Completion verification MUST map each Acceptance Criterion to fresh evidence records and their limits without copying those observations into `task.md`.

Task closure MUST complete `retrospective.md`, verify that improvements have real owners, and only then judge terminal task state. Archival remains a separate operator-authorized action.

Skill authoring MUST use configured skill locations. The task and retrospective may link to a skill change, but the Ledger bundle MUST NOT serve as a candidate skill discovery location.

## Failure Behavior

- If task intent is ambiguous, shaping remains incomplete; a plan MUST NOT invent intent.
- If required behavior is ambiguous, the specification or operator decision MUST resolve it before implementation.
- If execution progress is unknown, the plan remains incomplete; `task.md` MUST NOT manufacture progress.
- If an observation lacks adequate provenance, it MUST be reported with that limit rather than promoted as proof.
- If a review identifies remediation, the original review remains evidence and the plan tracks remediation.
- If a learning has no durable consumer, the retrospective records a substantive no-promotion rationale rather than creating unused metadata or task-local knowledge.

## Transition

The implementation changes the current scaffold, injected Ledger contract, documentation, lifecycle skills, and tests together. There is one current format after the change.

Archived bundles MUST remain byte-for-byte untouched by this work. No migration command, compatibility parser, schema version, old/new branch, or fallback behavior is introduced. Existing historical records remain understandable as artifacts of the contract active when they were created.

## Acceptance Mapping

- AC-001: Bundle Layout; Retrospective Contract.
- AC-002: Task Contract.
- AC-003: Actors and Boundaries; all artifact contracts; Lifecycle Behavior.
- AC-004: Plan Contract; Evidence Contract; Retrospective Contract; Lifecycle Behavior.
- AC-005: Transition.
- AC-006: Verified by repository checks and evidence produced during implementation.

## Exclusions

This specification does not change index row format, task IDs, dependency path resolution, `ledger_close` archival behavior, Git policy, external publication authority, or the distinction between evidence and semantic authority.
