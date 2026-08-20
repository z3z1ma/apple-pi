Status: done
Created: 2026-08-20
Updated: 2026-08-20

# Implementation plan

## Outcome

Ralph gains an adaptable increment prompt and a high-quality bounded advanced composition while remaining a fresh-context implementation loop by default. The in-progress review templates become the canonical standard-library review building block, and both skill bodies make the boundary explicit.

## Current-System Evidence

- `skills/pi-review/references/*.js` in the working tree now use `std.git.change`, `std.context.fit`, and, where candidate streams need it, `std.context.pack`.
- `skills/pi-ralph/references/ralph.js` is already a small sequential untyped worker loop. It has no controller-side review state, so review-oriented standard-library calls would add no semantic value.
- `skills/pi-ralph/references/ralph-reviewed.js` still manually collects Git state, clips contexts, count-truncates notes, and joins review decisions.
- `docs/ledger.md`, `skills/ledger-execute-task/SKILL.md`, and the Ralph skill make caller-run review after a default Ralph batch an intentional boundary.
- `tests/package-load.mjs` statically parses and guards packaged skill reference contracts; `tests/runtime.test.ts` owns standard-library runtime behavior.

## Change Surfaces

1. `skills/pi-review/references/plan-review-verify.js` and `skills/pi-review/SKILL.md`: canonical planned-review composition and ownership explanation.
2. `skills/pi-ralph/references/increment.md`, `ralph.js`, and `skills/pi-ralph/SKILL.md`: adaptable default worker prompt and bounded-loop contract.
3. `skills/pi-ralph/references/ralph-reviewed.js`: opt-in reviewed Ralph orchestration using the established review primitives while retaining Ralph-only snapshots and commit checks.
4. `tests/package-load.mjs`: parse and regression-contract checks for all changed reference programs.

## Sequence

1. Complete the canonical planned-review template: use serialized-size packing for verifier payloads, assignment coverage reporting, and decision reconciliation. Keep per-focus patch collection and controller validation; do not use `std.agents.planFanoutReduce`.
2. Add `increment.md` as the adaptable Ralph role-prompt source. Update default Ralph to retain sequential untyped coding workers, reject unsafe/non-canonical iteration counts, and return requested/completed iteration evidence without judging repository progress.
3. Rewrite the advanced reviewed template from the canonical review semantics. Use `std.git.change`, `std.context.fit`, `std.context.pack`, `std.coverage.compare`, and `std.reconcile.byId` for review operations. Preserve `git hash-object` snapshots and `git rev-parse HEAD`, because they detect dirty-tree mutations and commits that `std.git.change` cannot replace.
4. Update the two skill bodies and package-load contract checks. Validate changed files, then full relevant package checks. Reconcile the task’s evidence and review findings.

## Acceptance And Backpressure

| Criterion | Classification | Change and falsifying check |
| --- | --- | --- |
| AC-001 | Durable template invariant | Default reference parsing and static checks show adaptable prompt, strict caller iteration bound, explicit tools/profile, no planner/verifier/review function, and no `planFanoutReduce`. |
| AC-002 | Durable template invariant | Advanced reference parsing and static checks require standard-library primitives, strict bounded input, gap reporting, and reject old clipping/count-bound patterns. |
| AC-003 | Documentation/process evidence | Read both bodies against the canonical/default ownership boundary and link the exact references. |
| AC-004 | Packaging/invariant evidence | Run `git diff --check`, loader/package checks, and relevant automated tests; record actual limits. |

## Risks And Failure Modes

- `std.git.change` compares to `HEAD`; replacing pre/post fingerprints would miss an increment that alters an already-dirty file. Retain snapshots.
- `std.reconcile.byId` must surface unknown, duplicate, and missing verdict IDs rather than silently overlay them.
- The advanced template may not imply task completion merely because a bounded batch ends; return an honest incomplete status.
- The advanced example must remain opt-in and bounded, not undermine default caller-controlled review.

## Integration Points

- Ralph reviewed composition copies canonical planned-review mechanics but does not load review skills dynamically; prompt placeholders stay adaptable and local.
- Package-load tests protect the installable source surface. No runtime source, manifest, or docs changes are necessary.

## Rollback Or Recovery

All changes are packaged skill references and static test coverage. Revert the affected skill/reference/test files together if the composed template has an invalid guest API contract. Do not reset unrelated pre-existing working-tree changes.

## Related Records

- `.ledger/202608201212-upgrade-ralph-pi-exec-templates/task.md`
