---
name: review-reconciliation
description: "Use when review feedback must be checked against current code and governing intent before deciding what to change."
---

# Reconcile Review Feedback Once

Review feedback is a claim, not an instruction. Evaluate it technically, make the useful corrections, and finish the loop in the root session.

## Process

For each finding:

1. Identify the exact code path, trigger, and claimed impact.
2. Check current source, tests, and governing intent.
3. Classify it:
   - confirmed material defect;
   - confirmed minor improvement;
   - false positive;
   - unresolved because specific evidence is missing;
   - out of scope.
4. Fix confirmed in-scope issues directly when authorized.
5. Take minor improvements only when cheap and clearly better.
6. Reject incorrect advice with one evidence-backed reason.
7. Run the checks affected by the fixes.

Vague recommendations such as “make it robust” require a reachable failure before action. Feedback that exposes a real semantic choice returns that choice to the operator.

## No review ping-pong

Nits, ordinary fixes, and disagreements resolvable from code and tests conclude in the root. One scoped follow-up serves a material high-risk fix that remains difficult to verify locally.

If several findings are valid, batch them into one coherent fix rather than dispatching one worker per finding. The root owns integration and may finish or correct subagent work itself.

## Communication

Respond to the technical substance, not the reviewer's tone. External replies, PR comments, and publication require operator authorization; draft locally otherwise.

When Ledger is already serving as continuity, preserve material findings and their final dispositions; nits stay in the working report.

## Finish

Report confirmed fixes, rejected findings with reasons, checks run, and any material unresolved risk. Then stop reviewing.
