Status: recorded
Created: 2026-08-21
Updated: 2026-08-21

# WI-005 lifecycle closure and final verification

## Purpose

Verify the review, completion, closure, and skill-improvement portion of AC-004; preserve archived-bundle boundaries for AC-005; and gather the full repository evidence required by AC-006.

## Source State

- Base revision: `8706e4d302abdbf0f6dd334f4c73c51827902ada`.
- WI-005 changed paths:
  - `skills/review-commissioning/SKILL.md`
  - `skills/review-commissioning/review-gate.md`
  - `skills/review-commissioning/code-reviewer.md`
  - `skills/review-commissioning/references/ledger-gate.js` (fix-review provenance discovered during WI-004)
  - `skills/review-reconciliation/SKILL.md`
  - `skills/completion-verification/SKILL.md`
  - `skills/task-closure/SKILL.md`
  - `skills/skill-authoring/SKILL.md`
- Raw audits, command outputs, package listing, diff inspection, and gate-failure evidence are under `evidence/.storage/wi-005/` and `evidence/.storage/execution-final/`.

## Procedure

1. Ran the canonical route, shorthand, and complete ontology inventories before and after editing the WI-005 perimeter.
2. Routed all review observations/dispositions/coverage limits to evidence notes and remediation/blocking effects to active plans.
3. Replaced separate Retrospective/Distillation closure with the one top-level `retrospective.md` and its Summary, What Worked, What Could Improve, Learnings, and Improvements sections.
4. Removed task-local skill candidates; skill authoring now creates candidates directly in package, trusted-project, or personal configured skill owners and records progress/evaluation through plans and evidence.
5. Made completion verification and task closure repeat the full terminal predicate verbatim enough to preserve every material qualifier.
6. Re-ran the final lifecycle audits, focused stale-destination assertion, and `git diff --check`.
7. Ran `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run pack:check`, and a focused Biome format check over this task's changed formatter-supported files.
8. Compared archive content against the execution baseline, inspected the bounded active-surface diff for compatibility machinery, and inspected package contents.

## Observations

### Lifecycle contract

- WI-005 began with 14 route matches, 4 shorthand matches, and 146 complete-inventory matches. Stale paths included task-root Review, routine evidence in `task.md`, separate Retrospective/Distillation, task-local knowledge, and `.ledger/<task>/skills/`.
- The final full active-surface audit contains 46 route matches, 1 shorthand match, and 967 complete-inventory matches across 51 files. The sole shorthand match is an explicit prohibition in task shaping: specification review belongs in evidence and never in a task-root Review section.
- The WI-005 perimeter ends with 11 route matches, zero shorthand matches, and 146 complete-inventory matches. Remaining matches are current task/status language, review mechanics, evidence-note destinations, plan remediation/blocking, and closure predicate terms.
- The focused final stale assertion exited 1 with an empty output file.
- `git diff --check` passed.

### Repository checks

- Focused formatting over `components/shared/src/ledger-system-prompt.ts`, `extensions/ledger.ts`, both changed Ledger tests, `docs/ledger.md`, and `README.md` passed (4 formatter-supported source/test files checked; no fixes).
- `npm run typecheck` passed.
- `npm test` passed: 70 Vitest files / 695 tests, 110/110 advisor tests, and the package loader smoke test.
- `npm run pack:check` passed and included the changed Ledger extension, shared prompt, docs, lifecycle skills, review-gate reference, and tests' published owners where applicable.
- Repository-wide `npm run format:check` failed on `components/memory/src/session-ledger/projection.ts` and `components/memory/tests/drain.test.ts`.
- Repository-wide `npm run lint` failed on `components/memory/tests/drain.test.ts` (`useYield`) and reported an existing warning in `extensions/runtime-api.ts`.
- All three failing/warning files are byte-identical to `HEAD` and have no worktree status. This run did not modify them. Consequently AC-006's repository-wide format/lint requirement is **not satisfied**, even though the failures are independent of this task's changed paths.

### Archive and compatibility boundary

- The final tracked status and binary diff under `.ledger/history` are empty.
- A raw whole-history hash comparison detected a concurrent archive created after the baseline: `.ledger/history/202608211655-integrate-fleet-hint-into-input-card/` plus a changed ignored history index. This task did not create or modify that bundle.
- Comparing every archive-bundle path that existed at execution start (excluding the mutable history index) found zero missing or changed files. Three new files belong solely to the concurrent archive.
- The active-surface diff contains 31 changed files, all within planned owners.
- The compatibility-term scan produced two matches, both explicit documentation prohibitions: no legacy directories/schema versions/migration/fallback formats and no migration/compatibility system for archived formats. It found no runtime compatibility branch, parser, schema version, fallback, `_v2`, `new_`, or newly added active-surface file.
- Independent WI-005 review confirmed `OBS-WI005-01`: AC-006 remains blocked by repository-wide format/lint failures in byte-identical `HEAD` files outside this task. This is not an in-scope code defect and was not repaired.
- The same review confirmed `OBS-WI005-02`: task closure's unconditional “must fix” failure branch could force unrelated scope expansion. The branch now records procedure/attribution/limits, blocks when the failure belongs to task acceptance or integration, and routes demonstrably unrelated clean-HEAD failures to a separate owner without manufacturing a passing claim.
- Focused terminal-predicate/failure-ownership searches found the full dependency, plan, evidence-limit, review-disposition, retrospective, and unrelated-failure ownership clauses; the stale search was empty and `git diff --check` passed.
- Fresh whole-change review covered all 31 changed files with five completed focuses and complete candidate-decision coverage. It confirmed four significant findings: active decisions omitted from shaping authority (`FINAL-01`), research provenance omitted from plan-review context (`FINAL-02`), linked evidence omitted from sequential resume (`FINAL-03`), and plan/evidence/no-subagent/review boundaries omitted from the parallel example (`FINAL-04`). Three other candidates were independently rejected.
- Remediation now states active specifications and decisions govern semantics; includes relevant research and limits in plan review; recovers prior linked evidence/dispositions before sequential execution; and gives parallel workers scoped plan/evidence context with explicit no-subagent/no-review/no-integration rules plus controller reconciliation and independent review.

## Acceptance Mapping

- **AC-001:** `evidence/2026-08-21-wi-001-scaffold.md` records RED and 11/11 GREEN add/close tests for the exact root membership and retrospective scaffold.
- **AC-002:** the same WI-001 evidence records the exact intent-focused `task.md` assertion with removed dashboard sections.
- **AC-003:** `evidence/2026-08-21-wi-002-contract.md` records RED/GREEN prompt tests (9/9 GREEN), durable documentation alignment, and review approval.
- **AC-004:** `evidence/2026-08-21-wi-003-shaping-planning.md`, `evidence/2026-08-21-wi-004-execution-orchestration.md`, and this note record the before/after lifecycle audits, independent review remediation, plan/evidence routing, retrospective consolidation, and configured skill ownership.
- **AC-005:** the execution baseline and final intersection comparison show every pre-existing archived bundle file unchanged. The only history delta is a separately owned concurrent archive; the active diff contains no migration or compatibility implementation.
- **AC-006:** typecheck, tests, loader, package dry-run, changed-path formatting, and diff hygiene pass. Repository-wide format and lint do not pass because clean `HEAD` files outside this task fail their current Biome checks. AC-006 remains unmet.

## Limits

- Static instruction audits do not prove live model adherence.
- The initial archive hash was deliberately sensitive to concurrent Ledger activity; its failure prevents a false byte-for-byte claim. The narrower intersection comparison proves pre-existing bundle files unchanged but cannot reconstruct the baseline history-index text because only its hash was captured.
- Repository-wide format/lint remain nonzero in unchanged clean `HEAD` files; no claim says otherwise. After final review corrections and focused checks, the operator explicitly directed closure, commit, and push with this residual accepted and without another review cycle.
