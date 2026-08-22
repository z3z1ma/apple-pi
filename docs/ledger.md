# Ledger

Ledger is apple-pi's plain-Markdown workbench for consequential or multi-session work. It preserves authority, cold-start context, execution state, observed evidence, independent review, and retrospective learning without turning the transcript or product runtime into a task database.

Use the lightest form that preserves the outcome. Exact typo, formatting, and one-line mechanical work can remain record-free. Work that changes behavior, interfaces, persistence, side effects, verification paths, or spans sessions normally needs one governing task.

## Mental model

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

Ledger work moves through three roles, even when one session performs them sequentially:

1. **Shaping** establishes task intent, outcome, scope, non-goals, Acceptance Criteria, constraints, and references. It may produce research, decisions, and an optional specification.
2. **Orchestration** creates an executable plan, selects bounded Work Items and owners, sequences dependencies, commissions implementation and independent review, and judges closure.
3. **Execution** owns one plan Work Item or acceptance gap, changes only that surface, updates plan progress, and writes observed verification or review material under `evidence/`.

Semantic ambiguity returns to shaping. Execution does not invent product choices merely because a convenient implementation exists.

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

It does not decide whether the task is complete. Closure readiness is established by the task, plan, evidence, review dispositions, dependencies, and retrospective before the operator authorizes archival.

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

Shaping replaces every placeholder before planning or execution. Task status is `open | active | blocked | done | cancelled`. When a task is blocked, the owning plan, research record, decision need, or dependency describes the condition and `References` links it.

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

`evidence/` is the task's validation laboratory notebook and captured-artifact boundary. Routine and exceptional observations used to validate acceptance, behavior, implementation, environments, or reviews belong there rather than in `task.md`.

An evidence note must identify:

- the purpose, claim, or Acceptance Criterion investigated;
- the exact procedure;
- observed results, including failures and surprises; and
- limits—what the observation does not establish.

It also records the relevant source revision, configuration, runtime, deployment, or test environment when those conditions affect interpretation. Logs, screenshots, command output, reports, or captured data are linked or embedded when they form part of the observation.

Review output belongs in evidence because review is a provenance-bearing assessment. Remediation progress resulting from review belongs in the active plan. Failed and contradictory observations remain valid evidence.

Status: `recorded`.

## Retrospective

Every task has one top-level `retrospective.md`. It is the single learning-and-improvement record:

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

Closure replaces every placeholder and sets Status to `complete`.

- `Summary` explains how execution unfolded relative to intent and plan.
- `What Worked` captures practices and decisions worth retaining.
- `What Could Improve` captures friction, errors, surprises, and avoidable cost.
- `Learnings` states generalizable conclusions supported by task experience and evidence.
- `Improvements` identifies actual changes made to durable owners such as `AGENTS.md`, documentation, tests, runbooks, configured skills, or a separately owned follow-up task.

The retrospective synthesizes rather than duplicates evidence. A substantive explanation that no durable promotion was warranted is acceptable.

## Completion and archival

A task may be marked `done` only when:

- every dependency resolves to a `done` task;
- no referenced research, decision need, plan, or dependency still blocks the outcome;
- no active plan remains, and every plan for the outcome is `complete` or `superseded`, with its work complete or substantively cancelled with a rationale;
- every Acceptance Criterion has adequate supporting evidence under `evidence/` with applicable limits;
- every review finding and remediation is resolved, rejected with evidence, or explicitly bounded with rationale, owner, and revisit condition; and
- `retrospective.md` is complete.

A paused or blocked task keeps an honest non-terminal status. Archival through `ledger_close` is a separate operator-owned action after closure readiness is established.

## Workflow skills

The packaged lifecycle skills specialize this model:

| Activity | Primary skills | Ledger effect |
| --- | --- | --- |
| Shape intent and semantics | `task-shaping`, `root-cause-debugging` | Complete `task.md`; create research, decisions, or an optional specification when needed. |
| Plan implementation | `implementation-planning` | Create an active plan whose Work Items and state own execution progress. |
| Execute and orchestrate | `plan-execution`, `work-item-orchestration`, `parallel-orchestration`, `test-first-development`, `workspace-isolation`, `ralph` | Update plan state and write observed results under `evidence/`. |
| Review and verify | `review-commissioning`, `review-reconciliation`, `completion-verification` | Store observations and dispositions in evidence; track remediation in the plan. |
| Learn and close | `task-closure`, `skill-authoring` | Complete `retrospective.md`, improve real project owners, then present archival/integration choices. |

The skills guide agents; they do not create a second runtime task engine or state store.

## Boundaries

Ledger is intentionally not:

- a parser-backed task database or global operations dashboard;
- a product runtime store;
- an issue-tracker mirror;
- an ambient active-task pointer;
- a candidate-skill discovery directory;
- a migration or compatibility system for archived task formats; or
- authority to commit, merge, push, publish, deploy, or delete work.

Archived bundles remain historical records of the contract active when they were created. Current tooling creates one current format and does not rewrite history.
