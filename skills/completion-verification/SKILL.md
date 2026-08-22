---
name: completion-verification
description: "Use when about to make an empirical claim that work is complete, fixed, passing, or ready for integration."
---

# Verify Before Claiming Completion

Evidence must match the claim. Verification should be fresh, direct, and proportionate.

## The check

Before an empirical success claim:

1. Identify the cheapest procedure that could falsify that exact claim.
2. Run it on the current tree.
3. Read the output and exit status.
4. Inspect the actual changed or expected artifact when existence/content matters.
5. State the result and its limits.

Examples:

- “loader test passes” requires the loader test, not the full suite.
- “all tests pass” requires the full relevant suite.
- “the skill exists and is packaged” requires checking the file, loader discovery, and package contents.
- “bug fixed” requires exercising the original symptom or a regression test.
- “agent completed” requires inspecting the diff and relevant checks, not trusting its report.

## Breadth follows the claim and risk

Use a focused check for a focused change. Run broader suites when the change has broad reach, integration risk, or the operator requests them. Verification-only machinery earns its place through a production consumer or concrete high-cost failure.

When a check cannot run, say `Not verified` and why. This limits the claim; it does not require inventing a fallback success state.

## Review and delegation

Advisor, agent, and reviewer reports are useful claims, not proof. Validate material points once. Completion does not require an independent review unless the operator requested it or a concrete named risk justifies it.

Nits and optional cleanup remain optional; confirmed material defects block completion.

## Ledger

If a Ledger task is active, map only its load-bearing Acceptance Criteria to adequate observations. A concise task may close from verified repository state; use its retrospective only when there is learning worth preserving.

## Before integration

Check the staged/committed paths so unrelated work is not included. If the operator explicitly authorized commit, push, merge, or publication, proceed after verification without asking again.

Then report:

- what changed;
- checks run and results;
- what remains unverified;
- material residual risk.
