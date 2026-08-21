---
name: ledger-verification-before-completion
description: "Use when about to claim Ledger-governed work is complete, fixed, passing, or ready for integration."
---

# Verification Before Completion

## Overview

**Core principle:** Evidence before claims, always.

**Violating the letter of this rule is violating the spirit of this rule.**

## Ledger State: Closure Evidence

Verification is the evidence half of closure, not closure by itself. Identify the governing task and map each claim to the relevant `AC-###`, command or observation, and limit. The orchestrator also checks dependencies, Blockers, Work Items, review disposition, follow-up ownership, Retrospective, and Distillation before marking a task done. Keep routine results in `task.md`; create `evidence/` records only for observations that another task or future investigation will need.

## The Iron Law

```
NO COMPLETION CLAIMS WITHOUT FRESH VERIFICATION EVIDENCE
```

If you haven't run the verification command in this message, you cannot claim it passes.

## The Gate Function

```
BEFORE making an empirical success, correctness, completion, or integration-readiness claim:

1. IDENTIFY: What procedure proves this exact claim?
2. RUN: Execute the claim-matched procedure fresh and completely. Broad completion claims require the full relevant suite; narrow intermediate claims require the narrow falsifying check.
3. READ: Full output, check exit code, count failures
4. VERIFY: Does output confirm the claim?
   - If NO: State actual status with evidence
   - If YES: State claim WITH evidence
5. ONLY THEN: Make the claim

Skip any step = lying, not verifying
```

## Common Failures

| Claim | Requires | Not Sufficient |
|-------|----------|----------------|
| Tests pass | Test command output: 0 failures | Previous run, "should pass" |
| Linter clean | Linter output: 0 errors | Partial check, extrapolation |
| Build succeeds | Build command: exit 0 | Linter passing, logs look good |
| Bug fixed | Test original symptom: passes | Code changed, assumed fixed |
| Regression test works | Red-green cycle verified | Test passes once |
| Agent completed | VCS diff shows changes | Agent reports "success" |
| Requirements met | Line-by-line checklist | Tests passing |

## Red Flags - STOP

- Using "should", "probably", "seems to"
- Expressing satisfaction before verification ("Great!", "Perfect!", "Done!", etc.)
- About to commit/push/PR without verification
- Trusting agent success reports
- Relying on partial verification
- Thinking "just this once"
- Tired and wanting work over
- **ANY wording implying success without having run verification**

## Rationalization Prevention

| Excuse | Reality |
|--------|---------|
| "Should work now" | RUN the verification |
| "I'm confident" | Confidence ≠ evidence |
| "Just this once" | No exceptions |
| "Linter passed" | Linter ≠ compiler |
| "Agent said success" | Verify independently |
| "I'm tired" | Exhaustion ≠ excuse |
| "Partial check is enough" | Partial proves nothing |
| "Different words so rule doesn't apply" | Spirit over letter |

## Key Patterns

**Tests:**
```
✅ [Run test command] [See: 34/34 pass] "All tests pass"
❌ "Should pass now" / "Looks correct"
```

**Regression tests (TDD Red-Green):**
```
✅ Write → Run (pass) → Revert fix → Run (MUST FAIL) → Restore → Run (pass)
❌ "I've written a regression test" (without red-green verification)
```

**Build:**
```
✅ [Run build] [See: exit 0] "Build passes"
❌ "Linter passed" (linter doesn't check compilation)
```

**Requirements:**
```
✅ Re-read plan → Create checklist → Verify each → Report gaps or completion
❌ "Tests pass, phase complete"
```

**Agent delegation:**
```
✅ Agent reports success → Check VCS diff → Verify changes → Report actual state
❌ Trust agent report
```

## When To Apply

**ALWAYS before:**
- Any empirical success, correctness, completion, fixed, passing, or ready claim
- Committing, PR creation, task completion, or irreversible integration
- Moving to the next Work Item on the claim that the current one is complete
- Accepting an agent or reviewer report as true

Delegation itself is governed by authority, scope, and handoff readiness; it does not require pretending the delegated work is already verified. Ordinary factual progress updates cite the observation they report without running a disproportionate full suite.

**Rule applies to:**
- Exact phrases
- Paraphrases and synonyms
- Implications of success or correctness
- Any communication that could cause downstream work or integration to rely on an empirical claim
