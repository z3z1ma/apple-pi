---
name: ledger-requesting-code-review
description: "Use when completing a Ledger Work Item, implementing a major feature, or before integration to request independent code review."
---

# Requesting Code Review

Use `pi-review` to catch issues before they cascade. Reviewers receive precisely crafted contract and diff context, never the producer's session history.

**Core principle:** Review early, review often.

## Ledger State: Adversarial Review

Review attempts to falsify the owning task's completion claim. Give the reviewer the smallest governing contract, comparison boundary, complete changed-file package, and criterion or risk it must challenge; withhold the producer's deliberation unless it is contractual. Record confirmed findings, rejected candidates with evidence, coverage gaps, verdict, and residual risk in `task.md` Review. Review does not repeat execution verification and does not close or repair the task by itself.

## When to Request Review

**Mandatory:**
- After each task in subagent-driven development
- After completing major feature
- Before merge to main

**Optional but valuable:**
- When stuck (fresh perspective)
- Before refactoring (baseline check)
- After fixing complex bug

## How to Request

**1. Bound the change:**

Record the governing task/Work Item, changed paths, and the comparison boundary. For uncommitted work use the working tree against `HEAD` or the Work Item's recorded base; for committed ranges use explicit base and head revisions.

**2. Run independent review:**

Load `pi-review` from its available-skills catalog location and select the smallest topology that covers this change.

For bounded specification, plan, Work Item, or scoped-fix Ledger gates, use the executable adapter in [review-gate.md](review-gate.md): read [references/ledger-gate.js](references/ledger-gate.js), pass its complete body to `pi_exec`, and supply the documented strict inputs. Do not dispatch the adjacent prose templates as free-form workers; translate their rubric into the adapter's `question`, `checks`, `paths`, and `contextPaths`. `fix` mode also requires typed `priorObservations` JSON so existing IDs are preserved.

Whole-change/final review uses `pi-review`'s full [plan-review-verify.js](../pi-review/references/plan-review-verify.js) topology with changed-path partitioning, fresh reviewers per focus, an independent verifier, and explicit coverage-gap accounting. Never substitute the bounded single-reviewer adapter for that gate.

**Inputs:**
- `{DESCRIPTION}` - Brief summary of what you built
- `{PLAN_OR_REQUIREMENTS}` - Governing task, Work Item, spec, and plan paths
- `{CHANGED_PATHS}` - Exact review perimeter
- `{COMPARE}` - Revision boundary when applicable
- `{CHECKS}` - Commands already run and their observed results

**3. Act on feedback:**
- Fix Critical issues immediately
- Fix Important issues before proceeding
- Note Minor issues for later
- Push back if reviewer is wrong (with reasoning)

## Example

```
[Just completed WI-002: Add verification function]

You: Let me request code review before proceeding.

[Run the executable Ledger review gate through `pi-review` with the task contract and bounded diff]
  DESCRIPTION: Added verifyIndex() and repairIndex() with 4 issue types
  PLAN_OR_REQUIREMENTS: WI-002 from .ledger/<task-id>/plans/deployment-plan.md
  CHANGED_PATHS: src/index.ts, tests/index.test.ts
  COMPARE: HEAD
  CHECKS: npm test -- tests/index.test.ts (14/14 passed)

[`pi-review` verifier returns]:
  Strengths: Clean architecture, real tests
  Issues:
    Important: Missing progress indicators
    Minor: Magic number (100) for reporting interval
  Assessment: Ready to proceed

You: [Fix progress indicators]
[Record review disposition; continue to WI-003]
```

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll just review the diff myself instead of dispatching a reviewer" | You're the coordinator — reviewing the diff inline burns the context window you need to keep driving the work. Run `pi-review`: the diff and the evaluation live in its context, and only the findings come back to you. |
| "The reviewer needs my whole session history to understand the change" | Hand it precisely crafted context, never your session's history. That keeps the reviewer on the work product, not your thought process. |

## Red Flags

**Never:**
- Skip review because "it's simple"
- Ignore Critical issues
- Proceed with unfixed Important issues
- Argue with valid technical feedback

**If reviewer wrong:**
- Push back with technical reasoning
- Show code/tests that prove it works
- Request clarification

Record confirmed findings, rejected candidates, unresolved evidence, and coverage limits in the governing Ledger task.
