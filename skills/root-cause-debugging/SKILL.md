---
name: root-cause-debugging
description: "Use when a bug, failing test, regression, or unexpected behavior needs diagnosis before a fix."
---

# Debug From Evidence

Find the cheapest observation that distinguishes plausible causes, then fix the cause and verify the original symptom. Evidence depth grows only with unresolved uncertainty.

## Fast loop

1. Reproduce the symptom or state clearly why it is not reproducible.
2. Read the failing path, immediate callers, contracts, and relevant recent change.
3. Form the smallest set of plausible hypotheses.
4. Run the cheapest discriminating check.
5. Follow the evidence to the first incorrect state or boundary.
6. Add a focused regression test when it protects a durable behavior.
7. Implement the smallest causal fix.
8. Verify the original symptom and relevant neighbors.

Move quickly when the evidence is clear; the root session and working report are sufficient.

## Escalate progressively

Use logs, temporary instrumentation, history, documentation, or an isolated reproduction only when direct inspection cannot distinguish causes. Remove temporary instrumentation before completion.

Commission a specialist once when the problem persists after concrete evidence, requires unfamiliar external/version-specific knowledge, or benefits from independent deep reasoning. Give it the complete evidence and hypotheses, then validate its answer and continue in the root.

## Boundaries

- Keep the fix scoped to the diagnosed cause.
- Preserve visible failure semantics and observability.
- Let tests express the intended behavior rather than the current defect.
- Change the hypothesis or method before repeating a failed action.
- Ask the operator only when product meaning, authority, destructive action, or external side effects are unresolved.

## When reproduction is unavailable

Mark the diagnosis provisional. Inspect contracts and telemetry, add the least invasive observation needed, and avoid claiming the bug fixed until the original behavior or a faithful regression check is exercised.

## Completion

Report the root cause, the change, the exact checks run, and remaining limits. Stop after the causal fix is verified.
