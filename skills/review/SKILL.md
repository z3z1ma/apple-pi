---
name: review
description: "Use when the operator requests a defect-focused review, audit, critique, or sanity-check of code or changes. For empirical completion claims and running checks, use completion-verification."
---

# Review Changes Once, Well

Find a small set of material, evidence-backed defects. Review is successful when it improves the change, not when it creates more review work.

## Establish the boundary

Identify:

- comparison revision or working-tree boundary;
- changed paths;
- intended behavior and relevant constraints;
- checks already run;
- specific high-risk questions, if any.

Inspect normalized status and the complete bounded diff, including untracked files. Read only the definitions, callers, tests, configuration, and lifecycle paths needed to verify the change.

## Choose the cheapest topology

- **Root review:** default for a bounded change. Inspect it directly and report findings.
- **One independent reviewer:** use when fresh context adds meaningful value or the operator asks for independent review. Give it the complete bounded assignment once.
- **Multiple independent lenses:** reserve for genuinely separate high-risk contracts such as authorization plus migration compatibility. Each lens runs once; the root reconciles.

These planner/reviewer/verifier chains and residual loops serve exceptional composed reviews with explicit independent risk questions. The `pi_exec` programs under `references/` remain available for those cases.

## Finding standard

Report a finding only when it establishes:

- changed or omitted location;
- concrete trigger or reachable path;
- evidence through relevant guards and consumers;
- observable impact;
- smallest coherent correction.

Severity:

- `critical`: realistic security compromise, data loss/corruption, or catastrophic outage;
- `significant`: reachable functional, compatibility, or operational failure that should block completion;
- `minor`: bounded correctness issue worth fixing but not worth another review cycle.

Findings focus on reachable defects; style preferences, speculative defenses, and unrelated cleanup stay outside the defect list. State coverage limits separately.

## Reconcile in the root

Validate every candidate against current source and governing intent. Fix confirmed issues yourself when authorized. Reject false positives with evidence. Treat nits as optional.

After fixes, rerun affected checks. Nits and ordinary corrections conclude in the root. One scoped follow-up serves a confirmed material high-risk fix that remains difficult to verify from code and tests.

## Report shape

1. Confirmed findings, ordered by severity.
2. Unresolved material questions, if evidence is genuinely insufficient.
3. Coverage limits.
4. Concise strengths only when useful.

If there are no material findings, say so directly and finish.
