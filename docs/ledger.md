# Ledger

Ledger is apple-pi's plain-Markdown workbench for consequential or multi-session work. It preserves authority, cold-start context, execution state, observed evidence, independent review, and retrospective learning without turning the transcript or product runtime into a task database.

Use the lightest form that preserves the outcome. Clear, bounded, reversible work executes directly even when it changes behavior. Create a governing task when consequential ambiguity, coordination, high-risk evidence, handoff, or multi-session continuity makes durable state valuable.

## Mental model

Ledger is the durable layer in a three-layer work model: [backlog](backlog.md) parks session-local ideas, [to-dos](todos.md) track active ephemeral execution, and Ledger owns durable intent, acceptance, decisions, and evidence. A Ledger task may use to-dos as a checklist, but a completed to-do is never acceptance evidence. Promote a to-do only by explicit agreement and successful `ledger_add`; delete its source only afterwards unless it remains an unambiguous execution step under Ledger authority.

One task owns one coherent observable outcome. Its artifacts have distinct provenance:

- `task.md` preserves shaped intent and acceptance; it is not a progress dashboard.
- `specs/` contains optional behavioral authority when semantics need a contract beyond task intent.
- `plans/` owns execution decomposition, Work Item state, progress, replanning, verification procedures, and evidence links.
- `research/` owns questions, sources, analysis, findings, conclusions, and limits.
- `decisions/` records consequential choices and their authority.
- `evidence/` is the validation laboratory notebook, including review observations and dispositions.
- `retrospective.md` synthesizes process learning and names improvements made in their real project owners.

Evidence records what was observed and how. It does not become product authority. A passing test proves its assertions, not unspecified correctness. A worker report is a claim until checked against repository state.

## Lifecycle

Ledger supports three activities without making them sequential gates:

1. **Shaping** establishes the intent and observable outcome needed to execute safely. It may add scope, non-goals, Acceptance Criteria, constraints, research, decisions, or a specification when they matter.
2. **Orchestration** optionally creates a plan, selects substantial Work Items and owners, sequences dependencies, and chooses risk-based review when coordination warrants it.
3. **Execution** delivers coherent increments in the root session or through deliberately chosen workers, updating durable progress or evidence only when another session needs it.

A task uses only the activities that help deliver its outcome. Semantic ambiguity returns to the operator rather than being hidden by a convenient implementation.

## Storage model

The live index is `.ledger/INDEX.md`. It contains searchable rows with task path, title, and description; task status remains in the task root. Closed bundles move unchanged under `.ledger/history/`, whose index records terminal status with the same search text.

A current task bundle has this structure:

```text
.ledger/
  INDEX.md
  YYYYMMDDhhmm-lowercase-kebab-slug/
    task.md
    retrospective.md
    specs/
    plans/
    research/
    decisions/
    evidence/
  history/
    INDEX.md
    YYYYMMDDhhmm-lowercase-kebab-slug/
```

The standard directories may remain empty. Create a supporting record only when a concrete consumer needs it. Supporting records stay inside their owning bundle; cross-task dependency edges point to another task root.

Teams commonly ignore `/.ledger/`; solo repositories may commit it. Ledger never authorizes changing `.gitignore`, committing, pushing, publishing, deploying, or deleting worktrees.

## Tools

### `ledger_add`

`ledger_add` creates one new timestamped bundle, the two root files, the five supporting directories, and a live-index row. It is a structure-creation primitive, not a task selector, parser, dashboard, or execution engine.

Required inputs are a one-line title and description. An optional lowercase kebab slug overrides the title-derived slug. Existing live or archived task IDs are never overwritten.

### `ledger_close`

`ledger_close` archives one live bundle as `done` or `cancelled`. It updates `Status` in `task.md` when needed, moves the entire bundle under `.ledger/history/`, removes its live-index row, and appends a history-index row.

It does not decide whether the task is complete. Closure readiness comes from the promised outcome, unresolved blockers or dependencies, and verification proportionate to the claim. Plans, evidence, review dispositions, and the retrospective participate only when the task actually used them.

Read and edit existing Ledger files with ordinary repository tools.

## Task root

`task.md` is the durable statement of why an undertaking exists and what outcome it seeks. It is the bundle root and authority for task identity and acceptance, not a lifecycle log.

A new task uses this ordered scaffold:

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

`Depends-On: .ledger/<task-id>/task.md` is an optional header immediately after `Updated`. Multiple dependencies are comma-separated and retain their live identity paths. Resolve a dependency first at its live path, then under `.ledger/history/`; it is ready only when the resolved task exists and has Status `done`. Dependency cycles are invalid.

Before execution, replace the placeholders that govern the work and remove unused placeholder bullets rather than manufacturing ritual content. Make intent and outcome actionable; define any load-bearing Acceptance Criteria that improve verification, or remove the scaffolded criterion when none adds value. Task status is `open | active | blocked | done | cancelled`. When a task is blocked, the owning plan, research record, decision need, or dependency describes the condition and `References` links it.

Acceptance Criteria use stable `AC-###` identifiers and describe observable outcomes or durable invariants. Completing a plan Work Item does not itself prove acceptance.

`Constraints` owns operator-ratified task-level restrictions and settled conditions. An execution-changing assumption that is not ratified must be investigated in research, settled in a decision or specification, or remain blocking; `References` links the owning record rather than adding an assumptions log to the task root.

## Supporting records

Every supporting Markdown record begins with `Status`, `Created`, and `Updated`.

### Specification — `specs/**/*.md`

A specification is optional. Use it when meaningful behavior, invariants, required/error behavior, or failure semantics must be fixed independently of implementation. It defines actors and boundaries, required behavior, scenarios, exclusions, assumptions with provenance, and Acceptance Criteria mappings. It never owns execution progress.

Status: `draft | active | superseded`. Active specifications and active decisions govern current semantics.

### Plan — `plans/**/*.md`

A plan is the execution instrument. It owns stable Work Item identifiers and state, dependencies, sequence, implementation surfaces, integration points, verification procedures, completed/cancelled/blocked/replanned work, and links to evidence.

A plan may change as implementation facts emerge, but it may not silently change task intent or specified behavior. Semantic changes return to shaping, research, a decision, or the specification.

Status: `draft | active | complete | superseded`. Only an active plan owns current execution.

### Research — `research/**/*.md`

A research record owns one question or hypothesis and the analytical provenance of investigating it. It records motivation, dated sources and methods, analysis, findings including null or contradictory results, conclusions, limits, and related records.

Research owns inquiry, citation, interpretation, and synthesis. An executed experiment or environment observation used to support acceptance belongs in `evidence/` and is linked from research. Do not copy the same observation into both locations. Research conclusions inform choices but do not authorize product semantics.

Status: `active | complete | superseded`.

### Decision — `decisions/**/*.md`

A decision records a consequential choice, authority and provenance, viable alternatives, consequences, limits, revisit conditions, and related records.

Status: `active | superseded`. Only an active decision governs current execution.

### Evidence — `evidence/**/*.md`

`evidence/` is available for load-bearing validation observations and captured artifacts that a future session needs. Routine successful commands do not require evidence files; the repository state and concise report are often sufficient.

An evidence note must identify:

- the purpose, claim, or Acceptance Criterion investigated;
- the exact procedure;
- observed results, including failures and surprises; and
- limits—what the observation does not establish.

It also records the relevant source revision, configuration, runtime, deployment, or test environment when those conditions affect interpretation. Logs, screenshots, command output, reports, or captured data are linked or embedded when they form part of the observation.

Review output belongs in evidence because review is a provenance-bearing assessment. Remediation progress resulting from review belongs in the active plan. Failed and contradictory observations remain valid evidence.

Status: `recorded`.

## Retrospective

Every generated task has one top-level `retrospective.md` scaffold available as its single learning-and-improvement record. Use it when the task produces learning worth preserving; its mere presence is not a closure obligation:

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

When the retrospective is useful, replace its placeholders and set Status to `complete`. Otherwise leave the scaffold untouched; do not invent lessons to satisfy the template.

- `Summary` explains how execution unfolded relative to intent and plan.
- `What Worked` captures practices and decisions worth retaining.
- `What Could Improve` captures friction, errors, surprises, and avoidable cost.
- `Learnings` states generalizable conclusions supported by task experience and evidence.
- `Improvements` identifies actual changes made to durable owners such as `AGENTS.md`, documentation, tests, runbooks, configured skills, or a separately owned follow-up task.

The retrospective synthesizes rather than duplicates evidence. When a retrospective is otherwise useful, a substantive explanation that no durable promotion was warranted is acceptable.

## Completion and archival

A task may be marked `done` when its promised outcome exists, dependencies and material blockers are resolved, any active plan is complete or superseded honestly, and verification is adequate for the claims and risk. Review records, detailed evidence notes, and retrospective depth are required only when the task actually used them; unused artifact categories are not closure gates.

A paused or blocked task keeps an honest non-terminal status. Archival through `ledger_close` is a separate operator-owned action after closure readiness is established.

## Workflow skills

The packaged lifecycle skills specialize this model:

| Activity | Primary skills | Ledger effect |
| --- | --- | --- |
| Shape intent and semantics | `task-shaping`, `root-cause-debugging` | Use conversation first; create durable records only when uncertainty or continuity warrants them. |
| Plan implementation | `implementation-planning` | Plan substantial dependent work; direct bounded changes skip this phase. |
| Execute and orchestrate | `plan-execution`, `work-item-orchestration`, `parallel-orchestration`, `test-first-development`, `workspace-isolation`, `ralph` | Prefer root execution; delegate or persist evidence only when the benefit is concrete. |
| Review and verify | `review-commissioning`, `review-reconciliation`, `completion-verification` | Match one-pass review and fresh checks to actual risk and claims. |
| Learn and close | `task-closure`, `skill-authoring` | Preserve useful learning and follow explicit integration direction without another approval gate. |

The skills guide agents; they do not create a second runtime task engine or state store.

## Boundaries

Ledger is intentionally not:

- a parser-backed task database or global operations dashboard;
- a product runtime store or active-execution checklist (use [to-dos](todos.md));
- an issue-tracker mirror;
- an ambient active-task pointer;
- a candidate-skill discovery directory;
- a migration or compatibility system for archived task formats; or
- authority to commit, merge, push, publish, deploy, or delete work.

Archived bundles remain historical records of the contract active when they were created. Current tooling creates one current format and does not rewrite history.
