---
name: tdd
description: Test-driven development. Use when the user wants to build features or fix bugs test-first, mentions "red-green-refactor", or wants integration tests.
---

# Test-Driven Development

TDD is the red → green loop. This skill is the reference that makes that loop produce tests worth keeping: what a good test is, where tests go, the anti-patterns, and the rules of the loop. Every section applies on every cycle: consult them before and during the loop, not after.

When exploring the codebase, read relevant domain-language pages in `.wiki/` (if they exist) so test names and interface vocabulary match the project's language, and respect authoritative ADRs, specifications, tests, and maintainer instructions in the area you are touching. Wiki and ledger content are supporting context rather than authority.

## When the loop fits

Use TDD for concrete behavior with an input, an observable output, and an expected result that comes from an independent source of truth. Pure wiring, configuration, type-only work, generated glue, or straight delegation does not benefit from a ritual test that merely restates the implementation. Explain that limit and follow any repository testing requirement that still governs the change.

For a hard or unexplained bug, read and follow [`diagnosing-bugs`](../diagnosing-bugs/SKILL.md) to establish the exact behavior, cause, and correct regression seam first. Once the behavior and seam are known, this red → green loop can drive the regression test and authorized fix.

TDD is a sequential reference, not an implementation driver. It does not need team fan-out or Pi Exec composition. Follow the repository's test layout. Durable tests and fixtures belong in the normal repository test tree; this skill creates no mandatory ledger artifact. Commits, dependency installation, publication, deployment, destructive actions, shared-system access, and other external effects require their own authority.

## What a good test is

Tests verify behavior through public interfaces, not implementation details. Code can change entirely; tests should not. A good test reads like a specification: "user can checkout with valid cart" tells you exactly what capability exists, and it survives refactors because it does not care about internal structure.

See [tests.md](references/tests.md) for examples and [mocking.md](references/mocking.md) for mocking guidelines.

## Seams: where tests go

A **seam** is the public boundary you test at: the interface where you observe behavior without reaching inside. Tests live at seams, never against internals. "Public" means the interface presented to the behavior's real callers; it does not require a package-wide export.

**Test only at explicitly confirmed seams.** On every TDD invocation, before writing or editing any test, list the exact seams you propose and explain what each catches, what it misses, and its feedback cost. Stop and wait for the operator to confirm them. An approved specification, repository convention, existing test, wiki page, or ledger task may inform the proposal but does not replace that fresh confirmation. If the work later needs a new seam, stop and confirm that addition before writing its test.

Ask: "What's the public interface, and which seams should we test?"

When the shape of that interface is itself in question—how deep the module is, where the seam belongs, or what the interface should expose—read and follow [`codebase-design`](../codebase-design/SKILL.md) for the shared module, interface, depth, seam, adapter, leverage, and locality vocabulary. Use it as a design reference before proposing seams.

## Anti-patterns

- **Implementation-coupled**: mocks internal collaborators, tests private methods, or verifies through a side channel (querying the database instead of using the interface). The tell: the test breaks when you refactor but behavior has not changed.
- **Tautological**: the assertion recomputes the expected value the way the code does (`expect(add(a, b)).toBe(a + b)`, a snapshot derived by hand the same way, a constant asserted equal to itself), so it passes by construction and can never disagree with the code. Expected values must come from an independent source of truth: a known-good literal, a worked example, or the specification.
- **Horizontal slicing**: writing all tests first, then all implementation. Bulk tests verify _imagined_ behavior: you test the _shape_ of things rather than user-facing behavior, the tests go insensitive to real changes, and you commit to test structure before understanding the implementation. Work in **vertical slices** instead: one test → one implementation → repeat, each test a **tracer bullet** that responds to what the last cycle taught you.

## Rules of the loop

- **Red before green.** Write one failing test, run it, and confirm it fails for the intended missing behavior. Then write only enough code to pass it. A test that fails because its setup, import, fixture, or assertion is broken has not established red.
- **One slice at a time.** One confirmed seam, one test, and one minimal implementation per cycle. Run the test green before selecting the next behavior.
- **Refactoring is not part of the loop.** It belongs to the later independent `/skill:code-review` stage, not the red → green implementation cycle.
