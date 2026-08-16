Status: active
Created: 2026-08-15
Updated: 2026-08-16
Depends-On: .ledger/202608151813-replace-caller-budget-arithmetic/task.md

# Converge TypeScript architecture, formatting, and quality controls

## Scope

After the budget-contract changes settle, make apple-pi's TypeScript and JavaScript organization deliberately consistent: assembly entrypoints should be thin, behavior should live behind cohesive domain seams, UI should use explicit UI modules, and formatting/linting should be automatically enforced. Preserve justified component boundaries and module regimes while reducing mixed responsibilities and branch-heavy God files without changing behavior.

## Non-goals

- A repository-wide rewrite or arbitrary one-class-per-file rule.
- Splitting cohesive Ralph, review, memory, VCC, or subagent domain modules solely because they are long.
- Converting VCC from its deliberate CommonJS/Bun regime to ESM as incidental cleanup.
- Moving every test into one directory without a production or maintenance consequence.
- Reformatting vendored provenance or generated dependency content.
- Changing review, Ralph, subagent, or Pi Exec product behavior owned by prerequisite tasks.

## Acceptance Criteria

- AC-001: A documented module convention covers component entrypoints, extension wrappers and composition exceptions, domain/controller/service modules, UI modules, test placement, exports, import suffixes, and the VCC CommonJS boundary.
- AC-002: `components/advisor/index.ts`, `extensions/runtime.ts`, and `components/subagents/src/index.ts` become assembly-oriented entrypoints by extracting independently testable formatting, persistence, dispatch, runtime, or registration responsibilities at evidence-backed seams.
- AC-003: Review and Ralph follow their established UI module boundaries; no duplicate generic fleet, overlay, status, or progress implementation remains.
- AC-004: Large cohesive controllers and algorithms remain intact unless measured complexity, dependency direction, or test seams justify a split; the change report explains every retained large module.
- AC-005: One formatter policy and `.editorconfig` produce deterministic output for root ESM code and the VCC package boundary, with a check mode that fails on drift.
- AC-006: Linting enforces high-signal correctness and maintainability rules without disabling existing type, test, security, or authority checks; complexity limits target functions and permit narrowly documented exceptions.
- AC-007: Formatting and structural extraction are separated into reviewable commits or change groups so semantic regressions are distinguishable from mechanical churn.
- AC-008: Unit and integration tests continue to cover each extracted seam, and typecheck, full tests, loader validation, formatter check, lint, and pack check pass on the final tree.
- AC-009: Contributor-facing documentation explains exact local quality commands and the rationale for justified structural exceptions.

## References

- `.ledger/202608151813-converge-typescript-architecture/research/current-state.md`
- `package.json`
- `tsconfig.json`
- `components/advisor/index.ts`
- `components/subagents/src/index.ts`
- `components/subagents/src/ui/`
- `components/review/src/`
- `components/ralph/src/`
- `components/vcc/package.json`
- `extensions/runtime.ts`

## Assumptions

- User-ratified: components should be homogeneous, polished, clean, low-complexity, and formatter-enforced rather than retaining source-specific styles accidentally.
- Record-backed: Budget changes touch the same entrypoints and must land first to avoid polishing obsolete structure.
- Record-backed: VCC's CommonJS package and Bun suite explain its import convention and are not accidental drift.
- Record-backed: file length alone is not evidence of mixed responsibility; extraction requires a consumer, test seam, or dependency-direction improvement.
- Execution constraint: Ralph executor Bash calls must contain exactly one shell command; run every validation command separately.

## Journal

- 2026-08-15: Opened after measuring component layouts, largest implementation files, entrypoint conventions, module regimes, indentation, tests, and absent quality tooling.
- 2026-08-15: Ordered this task after budget API work to avoid churn and make convergence the final quality pass.
- 2026-08-15: Removed the harness-operations UI dependency: it does not own or constrain this TypeScript organization work.
- 2026-08-16: Ralph execution requires one shell command per Bash call; recorded after the executor was denied for a compound validation command.

## Blockers

None.

## Evidence

Pending.

## Review

Pending.

## Retrospective

Pending.

## Distillation

Pending.
