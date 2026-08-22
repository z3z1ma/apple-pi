---
name: test-first-development
description: "Use when implementing behavior where a focused executable check can cheaply define an invariant, reproduce a bug, or prevent a meaningful regression."
---

# Test-First Development

Use tests to accelerate feedback and preserve important behavior. Test-first is a technique, not a ritual or an approval gate.

## Choose the cheapest useful check

Write a failing test first when:

- reproducing a bug;
- defining a durable public or internal invariant;
- changing error handling, state transitions, parsing, compatibility, or persistence;
- the test will prevent a plausible costly regression.

Use a direct existing check, typecheck, loader test, lint, build, or focused manual exercise when that proves the change more cheaply. Documentation, prompts, skills, configuration, generated artifacts, exploratory work, and trivial mechanical edits normally use these direct checks.

The operator may explicitly choose a different verification strategy; apply it directly.

## Red, green, improve

When test-first is useful:

1. Write the smallest test that expresses one meaningful behavior.
2. Run it and confirm it fails for the expected missing behavior—not a setup error.
3. Implement the smallest coherent change.
4. Run the focused test and relevant neighboring checks.
5. Improve names or structure only where the implementation needs it; keep checks green.

Correct implementation remains useful when a test is added afterward. Prove the test can fail by the cheapest safe method when that capability is uncertain.

## Good tests

A good test:

- exercises production behavior rather than a hard-coded mirror;
- would fail for a real regression;
- asserts outcomes at a stable boundary;
- is clear about the supported scenario;
- avoids mocks unless the boundary makes them necessary;
- does not force production abstractions that have no consumer.

Avoid testing implementation trivia, duplicating documentation as fixtures, or adding negative cases without a durable invariant or plausible high-cost failure.

## Progressive coverage

Start with the behavior being changed. Add edge cases when code structure, an observed bug, or a consequential boundary makes them relevant, then ship the first correct increment.

A focused test can justify moving forward. Run broader suites when the change has broad reach or before making a correspondingly broad claim.

## Ledger and review

Ledger evidence is optional. If a governing task genuinely needs durable RED/GREEN provenance, record concise commands and results. Otherwise test output and the repository diff are enough.

Test-first work does not automatically require task shaping, a plan, a subagent, or independent review. Those are separate risk decisions.

## Failure handling

- Test passes before implementation: determine whether behavior already exists or the assertion is ineffective.
- Test errors: fix setup until it reaches the intended boundary.
- Neighboring tests fail: diagnose whether the contract changed or implementation regressed.
- Test is disproportionately hard: simplify the design or choose a more direct boundary.

## Completion

Report the exact checks run and their results. Claim only what those checks establish.
