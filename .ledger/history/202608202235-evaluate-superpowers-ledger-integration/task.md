Status: done
Created: 2026-08-20
Updated: 2026-08-20

# Evaluate Superpowers integration with Ledger

## Scope

Study `obra/superpowers` at the recorded `main` revision and produce an evidence-backed, Ledger-native disposition and candidate delivery path for its portable methodology. This task owns research and a recommendation, not workflow implementation.

## Non-goals

- Copying Superpowers source, adding it as a dependency, or installing its bootstrap.
- Creating a second `.superpowers` state store, a Ledger catalog, an active-task pointer, an operations UI, a task judge, or a worktree manager.
- Changing production runtime, Ledger skills, documentation, package configuration, or tests before the operator ratifies a behavioral contract.
- Claiming that an unrun behavior evaluation or validation check passed.

## Acceptance Criteria

- AC-001: The investigated upstream source is identified by immutable revision, access method, and scope, including every workflow skill and its relevant supporting runtime material.
- AC-002: Every upstream methodology surface has a source-backed adopt, adapt, retain, or reject disposition relative to current Ledger, Ralph, Pi Exec, typed subagents, review, and Advisor ownership.
- AC-003: The recommendation names the smallest existing change owners, hard architectural exclusions, evaluation evidence, and user decision gates necessary before any implementation.
- AC-004: The study leaves apple-pi production behavior unchanged and records unverified behavioral-transfer limits honestly.

## Work Items

- [x] WI-001: Inspect Superpowers `main`, apple-pi workflow ownership, and current hard boundaries; record a complete disposition and candidate integration topology.

## References

- `.ledger/202608202235-evaluate-superpowers-ledger-integration/research/superpowers-main-methodology.md`
- `docs/ledger.md`
- `docs/boundaries.md`
- `components/shared/src/ledger-system-prompt.ts`
- `skills/ledger-shape-task/SKILL.md`
- `skills/ledger-research-task/SKILL.md`
- `skills/ledger-plan-task/SKILL.md`
- `skills/ledger-execute-task/SKILL.md`
- `skills/pi-ralph/SKILL.md`
- `skills/pi-review/SKILL.md`

## Assumptions

- Historical user request: this task investigated a clean integration of Superpowers methodology with Apple Pie's Ledger-centered workflow.
- Record-backed: the source of truth for the upstream study is commit `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`, recorded in the research record.
- Historical architecture evidence: this study recorded an existing rejection of a second Ledger runtime, catalog, active pointer, and operations hub; the successor's active fusion decision now governs any change.
- Superseded: the operator replaced the principles-only boundary with the near-wholesale fusion decision in `.ledger/202608202254-strengthen-ledger-workflow/decisions/fusion-scope.md`.

## Journal

- 2026-08-20: Created the research task after preserving existing dirty Ledger work owned by another task.
- 2026-08-20: Cloned `obra/superpowers` `main` at `b36e0829c6d0140e93cfef2ca599b1b07d4a7797`, inspected all methodology skills and relevant support material, and compared them with apple-pi's Ledger, Ralph, review, Pi Exec, subagent, Advisor, and boundary documentation.
- 2026-08-20: Completed a fresh-context architecture review. It supports principles-only adaptation into existing Ledger stages, contingent on baseline behavior evaluations and operator ratification.
- 2026-08-20: Operator initially ratified a Ledger-native boundary and created successor `.ledger/202608202254-strengthen-ledger-workflow/task.md`.
- 2026-08-20: Operator superseded the study's principles-only recommendation: the successor now owns a near-wholesale Superpowers/Apple Pie fusion with Ledger, typed subagents, and Pi Exec adaptations.

## Blockers

None. This closed study has no active blocker. Its principles-only constraints, including automatic bootstrap and global-prompt exclusions, are superseded by `.ledger/202608202254-strengthen-ledger-workflow/decisions/fusion-scope.md`; only higher-priority safety constraints and the successor's active decision/specification govern future work.

## Evidence

- AC-001 through AC-003: `.ledger/202608202235-evaluate-superpowers-ledger-integration/research/superpowers-main-methodology.md` records the upstream revision, complete skill inventory, comparison method, disposition matrix, exact current owners, candidate stage-local paths, decision gates, and limits.
- AC-004: `git status --short --branch` before and after the study showed only pre-existing Ledger work plus this new study task and its research record; no production source, test, documentation, manifest, or package files were changed in this run.

## Review

- 2026-08-20: Independent fresh-context architecture review checked the complete upstream and apple-pi workflow sources. It independently recommended a Ledger-native, principles-only adaptation; it confirmed the no-second-runtime, no-bootstrap, no-automatic-worktree, and no-worker-integration boundaries. Its conclusions are captured and source-checked in the research record.

## Retrospective

Superpowers contributes valuable behavioral gates, but its controller/workspace mechanics duplicate capabilities that Ledger, Ralph, Pi Exec, `pi-review`, typed subagents, and Advisor already own. A source-level port would weaken Apple Pie's single-authority design rather than compose with it.

## Distillation

Distilled into successor `.ledger/202608202254-strengthen-ledger-workflow/task.md`: its active fusion decision supersedes this study's principles-only recommendation, while this task's upstream inventory remains source evidence. No durable repository promotion is warranted yet because the fused workflow has not been implemented or validated.
