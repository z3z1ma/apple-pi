---
name: code-review
description: "Review a change with a review board on two axes, repository standards and originating intent. Use when asked to review a branch, a pull request, the working tree, or the changes since a revision."
---

# Code review

A review board decides whether a change is well made (**Standards**) and whether it is the right change (**Intent**). The two axes stay separate from first look to final report, so success on one cannot hide failure on the other.

## Prepare the brief

The requester (whoever runs this skill) pins the boundary and gathers the sources before anyone is staffed:

- **Boundary**: the comparison (`git diff <base>...HEAD` and its commit list, or `HEAD` plus staged, unstaged, and untracked files for the working tree), resolved and non-empty. Ask when a branch has no sound base.
- **Standards sources**: the repository instructions and documents that govern the changed area.
- **Intent source**: the governing ledger task, specification, issue, or the request itself. When none exists, the Intent axis is reported as not assessed.

The brief holds the boundary, the changed paths, the sources, and the checks already run. It leaves out the author's reasoning: reviewers judge what the change does, not what it was meant to do.

## Staff the board

| Change | Board |
| --- | --- |
| Small | one `code-review-specialist` covering both axes |
| Normal | one `code-review-specialist` per axis, a `scientific-skeptic`, and the author |
| Risky area | the normal board plus a domain lens, such as `staff-security-engineer`, `database-reliability-architect`, or `performance-engineering-lead` |

The **chair** runs the board and rules on findings. The chair is never the author: when the requester wrote the change, a standing `code-review-specialist` chairs, and the requester takes part only as author. Staff with standing people as [handbook-writing](../handbook-writing/SKILL.md) describes, and give a large change's paths to reviewers so the chair can check that every changed path was covered. Staff the whole board before briefing anyone, and give every member the names of the others.

## Run the board

1. **First findings, alone.** Each reviewer works only from the brief and sends findings for one axis to the chair privately, before seeing anyone else's.
2. **Challenge.** The chair posts all findings in one review thread, a `send_mail` thread to the whole board; each member's assignment has its own task thread, so none of those reaches everyone. The skeptic challenges each finding's evidence; the author answers what the change was for and what it guards. Continue a disputed point with `reply` in that shared thread so the board sees the evidence and answers.
3. **Ruling.** Once every reviewer, the skeptic, and the author have replied, the chair checks each finding against current source and rules it **confirmed**, **rejected**, or **unresolved**.
4. **Close.** The board spends a short exchange on what made this review harder or easier, and the chair records it in the task's `retrospective.md`.

A finding states its location, the standard or requirement it breaks, the input or path that triggers it, the evidence, the impact, and the smallest fix. Severity is **critical** (security compromise, data loss, outage), **significant** (a reachable failure that should block completion), or **minor** (bounded and worth fixing). Style preferences and speculative defenses are not findings. Report every supported finding and nothing else.

## Report

```markdown
## Standards
Confirmed findings, worst first. Unresolved. Coverage limits.

## Intent
Intent source: <source, or not assessed>
Confirmed findings, worst first. Unresolved. Coverage limits.

Verdict: Standards: <clean, or N confirmed, worst ...>; Intent: <...>
```

Coverage limits name every path, axis, or reviewer the board did not complete. A clean axis says so plainly. The review reports; fixes follow only when the requester holds that authority.
