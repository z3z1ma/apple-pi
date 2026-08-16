Status: partial
Created: 2026-08-15
Updated: 2026-08-16
Depends-On: .ledger/202608151813-replace-caller-budget-arithmetic/task.md

# Converge TypeScript architecture, formatting, and quality controls

## Scope

After the budget-contract changes settle, make apple-pi's TypeScript and JavaScript organization deliberately consistent: assembly entrypoints should be thin, behavior should live behind cohesive domain seams, UI should use explicit UI modules, and formatting/linting should be automatically enforced. Reduce mixed responsibilities and branch-heavy God files without changing behavior.

## Non-goals

- A repository-wide rewrite or arbitrary one-class-per-file rule.
- Splitting cohesive Ralph, review, memory, VCC, or subagent domain modules solely because they are long.
- Moving every test into one directory without a production or maintenance consequence.
- Reformatting vendored provenance or generated dependency content.
- Changing review, Ralph, subagent, or Pi Exec product behavior owned by prerequisite tasks.

## Acceptance Criteria

- AC-001: A documented module convention covers component entrypoints, extension wrappers and composition exceptions, domain/controller/service modules, UI modules, test placement, exports, and NodeNext import suffixes.
- AC-002: `components/advisor/src/index.ts`, `extensions/runtime.ts`, and `components/subagents/src/index.ts` become assembly-oriented entrypoints by extracting independently testable formatting, persistence, dispatch, runtime, or registration responsibilities at evidence-backed seams.
- AC-003: Review and Ralph follow their established UI module boundaries; no duplicate generic fleet, overlay, status, or progress implementation remains.
- AC-004: Large cohesive controllers and algorithms remain intact unless measured complexity, dependency direction, or test seams justify a split; the change report explains every retained large module.
- AC-005: One formatter policy and `.editorconfig` produce deterministic output across all TypeScript and JavaScript, with a check mode that fails on drift.
- AC-006: Linting enforces high-signal correctness and maintainability rules without disabling existing type, test, security, or authority checks; complexity limits target functions and permit narrowly documented exceptions.
- AC-007: Formatting and structural extraction are separated into reviewable commits or change groups so semantic regressions are distinguishable from mechanical churn.
- AC-008: Unit and integration tests continue to cover each extracted seam, and typecheck, full tests, loader validation, formatter check, lint, and pack check pass on the final tree.
- AC-009: Contributor-facing documentation explains exact local quality commands and the rationale for justified structural exceptions.

## References

- `.ledger/202608151813-converge-typescript-architecture/research/current-state.md`
- `package.json`
- `tsconfig.json`
- `components/advisor/src/index.ts`
- `components/subagents/src/index.ts`
- `components/subagents/src/ui/`
- `components/review/src/`
- `components/ralph/src/`
- `extensions/runtime.ts`

## Assumptions

- User-ratified: components should be homogeneous, polished, clean, low-complexity, and formatter-enforced rather than retaining source-specific styles accidentally.
- Record-backed: Budget changes touch the same entrypoints and must land first to avoid polishing obsolete structure.
- User-ratified: VCC follows the repository's NodeNext imports, formatter policy, and component layout.
- Record-backed: file length alone is not evidence of mixed responsibility; extraction requires a consumer, test seam, or dependency-direction improvement.
- Execution constraint: Ralph executor Bash calls must contain exactly one shell command; run every validation command separately.

## Journal

- 2026-08-15: Opened after measuring component layouts, largest implementation files, entrypoint conventions, module regimes, indentation, tests, and absent quality tooling.
- 2026-08-15: Ordered this task after budget API work to avoid churn and make convergence the final quality pass.
- 2026-08-15: Removed the harness-operations UI dependency: it does not own or constrain this TypeScript organization work.
- 2026-08-16: Ralph execution requires one shell command per Bash call; recorded after the executor was denied for a compound validation command.
- 2026-08-16: User directed removal of remaining component-layout exceptions; VCC moved to the shared NodeNext/ESM and formatting conventions, and copied license texts were consolidated into `THIRD_PARTY_NOTICES.md`.

## Blockers

None.

## Evidence

- 2026-08-16: Extracted advisor formatting/configuration, Pi Exec types/program/fetch, and subagent activity/notification/UI seams; public entrypoints now assemble their respective components.
- 2026-08-16: Added Biome 2.5.8, `.editorconfig`, deterministic `format`/`format:check`/`lint`/`check` scripts, and `docs/development.md`.
- 2026-08-16: Passed `npm run format:check`, `npm run typecheck`, `npm test`, and `npm run pack:check`. `npm test` covered 457 Vitest tests, 421 VCC Bun tests, 79 advisor harness checks, and package loading.

## Review

Not verified: Ralph's fresh executor repeatedly stopped before implementation with `authority_required` because it issued compound Bash commands despite the recorded one-command constraint. No independent review was run after the operator instructed direct implementation rather than further agent delegation.

## Retrospective

Kept Review/Ralph controllers, VCC algorithms, advisor runtime state, Pi Exec invocation state, and subagent lifecycle controllers intact because each is cohesive; documented the reasons in `docs/development.md`. Formatter churn is mechanically separate from the extracted entrypoint seams in the diff, but remains uncommitted pending operator integration direction.

## Distillation

Promoted the lasting module, test-placement, import-boundary, formatting, lint, and complexity-exception conventions to `docs/development.md`; that document is the ongoing maintainer-facing owner. No new reusable skill emerged: the failed Ralph executor is an unresolved harness issue, not a repeatable repository procedure.
