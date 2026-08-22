Status: done
Created: 2026-08-21
Updated: 2026-08-21

# Redefine Ledger task artifact model

## Intent

Replace the overloaded Ledger task root with a coherent artifact ontology. A task must preserve the shaped intent of an undertaking without also acting as its specification, implementation plan, evidence log, review ledger, and learning report.

## Outcome

New Ledger bundles distinguish durable intent, behavioral specification, execution progress, research, decisions, observed evidence, and retrospective improvement by provenance. The scaffold, injected contract, documentation, lifecycle skills, and executable tests teach one consistent model.

## Scope

- Redefine `task.md` as the durable statement of task intent, outcome, boundaries, acceptance, constraints, and references.
- Make plans own work-item decomposition and execution progress.
- Make `evidence/` the home for provenance-bearing validation laboratory notes, including verification and review observations, while research retains the distinct provenance of inquiry and synthesis.
- Replace task-root Retrospective and Distillation sections with one top-level `retrospective.md` that connects process learning to concrete project improvements.
- Remove task-local `knowledge/` and `skills/` from the bundle contract and scaffold.
- Update all active Ledger documentation, prompts, lifecycle skills, and tests that depend on the old model.

## Non-goals

- Rewriting or migrating archived historical task bundles.
- Adding compatibility loaders, schema versions, or parallel old/new task formats.
- Changing Ledger indexing, dependency resolution, archival mechanics, or external integration policy.
- Moving packaged or configured project skills from their existing authoritative locations.

## Acceptance Criteria

- AC-001: `ledger_add` creates `task.md`, `retrospective.md`, and exactly the `specs/`, `plans/`, `research/`, `decisions/`, and `evidence/` supporting directories.
- AC-002: A newly scaffolded `task.md` describes intent and acceptance without Work Items, Journal, Evidence, Review, Retrospective, or Distillation sections.
- AC-003: The active Ledger contract consistently defines tasks as intent, specifications as behavioral contracts, plans as execution and progress owners, evidence as provenance-bearing laboratory notes, and `retrospective.md` as the single learning-and-improvement record.
- AC-004: Active lifecycle skills write execution progress to plans, observed verification and review material to `evidence/`, and closure learning to `retrospective.md`; none instruct agents to create task-local skills or knowledge records.
- AC-005: Existing archived bundles remain untouched, and no compatibility or migration implementation is introduced.
- AC-006: Relevant automated tests, type checking, package validation, changed-path formatting, and diff hygiene pass; the operator accepts the recorded byte-identical clean-HEAD repository-wide format/lint residual at closure without a passing claim for those two gates.

## Constraints

- Preserve one current artifact model rather than supporting dual formats.
- Preserve evidence as observation, not authority; evidence records procedure, environment, observations, artifacts, and limits.
- Preserve the distinction between task acceptance and plan progress.
- Durable project learning must be promoted to its actual owner, such as `AGENTS.md`, documentation, tests, runbooks, or configured skills.
- Preserve the operator's unrelated in-progress `.ledger` archival moves.
- Operator-directed closure accepts the recorded clean-HEAD repository format/lint residual without claiming those gates passed.

## References

- `.ledger/202608211538-redefine-ledger-task-artifact-model/specs/ledger-artifact-model.md`
- `.ledger/202608211538-redefine-ledger-task-artifact-model/plans/2026-08-21-ledger-artifact-model.md`
- `.ledger/202608211538-redefine-ledger-task-artifact-model/evidence/2026-08-21-whole-change-review.md`
- `docs/ledger.md`
- `extensions/ledger.ts`
- `components/shared/src/ledger-system-prompt.ts`
- `AGENTS.md`
