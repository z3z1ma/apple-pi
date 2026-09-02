# Test-driven development

Source: `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`

Status: approved; implementation and validation complete

## Target

Preserve upstream `tdd` as a sequential reference discipline for concrete feature behavior and known bug behavior: agree the public test seams, then work in vertical red → green slices whose tests survive internal refactoring. Keep durable tests in the repository's normal test tree and keep refactoring in the later `code-review` stage.

## Upstream doctrine to preserve

- TDD is a reference, not an implementation driver or orchestration system.
- Tests verify caller- or user-visible behavior through public interfaces.
- A seam is the public boundary where behavior is observed without reaching into implementation details.
- Test names describe capabilities and expected values come from an independent source of truth.
- Work proceeds one seam, one failing test, and one minimal implementation at a time.
- Red must be observed before green; horizontal batches of tests before implementation are rejected.
- Implementation-coupled, tautological, and horizontal-slice tests are explicit anti-patterns.
- Mocks belong at system boundaries only; internal collaborators remain real.
- `codebase-design` owns interface and seam-design vocabulary when the interface itself is uncertain.
- Refactoring is outside the red → green loop and belongs to `code-review`.

## Apple Pi translations

- Replace optional root `CONTEXT.md` reading with relevant `.wiki/` domain-language pages when present; repository docs, approved specs, tests, ADRs, and maintainer instructions remain authoritative.
- Use `/skill:code-review`, not the removed `review` name, for the later independent review/refactoring stage.
- Keep TDD root-owned and sequential. It does not need team fan-out or Pi Exec composition.
- A hard or unexplained defect starts with `diagnosing-bugs`; once the exact behavior and correct seam are known, TDD may drive the regression-test/fix slice.
- Durable tests and fixtures live under the repository's established test layout. Ledger task text may help locate intent or preserve continuity, but it is a model-writable workbench rather than authority and cannot approve a seam. TDD creates no mandatory ledger artifact.
- Commits, publication, deployment, dependency installation, destructive operations, and external effects remain separately authorized.
- Package the upstream examples as `references/tests.md` and `references/mocking.md`.

## Proposed applicability gate

Use TDD when there is concrete behavior with an input, observable output, and an independent expected result. Do not force the loop onto pure wiring, configuration, type-only work, straight delegation, or generated glue when the only possible assertion would restate the implementation. Existing repository instructions may still require tests for such changes.

## Operator decisions

1. Every TDD invocation must list the proposed seams and stop for fresh operator confirmation before writing any test. Approved specifications, repository conventions, existing tests, wiki context, and ledger material may inform the proposal but do not replace that confirmation. Explain what each candidate seam catches, misses, and costs before asking.
2. TDD remains red → green only. Refactoring belongs to the later independent `/skill:code-review` stage.
3. A proposed browser or end-to-end seam follows repository authority and is included in the same explicit seam confirmation with its feedback cost and lower-seam alternatives; no separate package-wide browser policy is added.
4. Add the applicability gate from the upstream companion guidance. Use TDD only for concrete behavior with observable input/output and an independent expected result. Do not force the loop onto pure wiring, configuration, type-only work, generated glue, or straight delegation unless repository authority requires tests.

## Implementation scope

- Add `skills/tdd/SKILL.md` from the pinned upstream source with only the agreed wiki, authority, skill-name, diagnosis, ledger, and applicability translations.
- Add `skills/tdd/references/tests.md` and `skills/tdd/references/mocking.md` from the upstream companions.
- Update the current package catalog, loader/runtime assertions, README, provenance, and boundaries for the new physical skill.
- Add focused checks for the absolute pre-test seam-confirmation gate, red-before-green, vertical slices, independent expected values, public-interface tests, system-boundary-only mocks, the applicability gate, wiki/ADR reading, `diagnosing-bugs` and `codebase-design` routing, `/skill:code-review`, and separate authority over commits and external effects.

## Validation

- A focused loader/doctrine suite verifies the exact trigger, fresh seam-confirmation gate, seam trade-offs, red-before-green loop, vertical slicing, independent expected values, public-interface testing, applicability gate, wiki/ledger authority, skill routing, external-effect authority, and both upstream references.
- The real loader discovers `tdd` with model invocation enabled and no diagnostics.
- The package dry run contains `SKILL.md`, `references/tests.md`, and `references/mocking.md`.
- The final implementation passed 85 focused runtime/TDD tests, the 905-test unit suite, typecheck, loader validation, formatting, focused lint, and `git diff --check`.
