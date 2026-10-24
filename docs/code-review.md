# Code Review

`code-review` is a business process, not an automatic lifecycle gate. The model loads it when asked to review a branch, a pull request, the working tree, or the changes since a revision, and `implement` uses it before committing:

```text
/skill:code-review
```

## Two independent axes

A complete review asks:

1. **Standards**: does the change follow the repository's documented conventions and engineering constraints?
2. **Intent**: does the change deliver what the originating request, task, or specification asked for?

The axes stay separate from the first findings to the report. When no intent source exists, the report says the Intent axis was not assessed rather than calling it a pass.

## The review board

The requester pins the boundary and the sources, then staffs a board with standing people (see [organization](organization.md#processes)):

| Change | Board |
| --- | --- |
| Small | one Code Review Specialist covering both axes |
| Normal | one Code Review Specialist per axis, a Scientific Skeptic, and the author |
| Risky area | the normal board plus a domain lens from the role catalog |

The chair runs the board and rules on findings, and is never the author. Reviewers send their first findings to the chair alone, so no view is shaped by another. The chair then posts them in one review thread, where the skeptic challenges the evidence and the author answers; the chair rules each finding confirmed, rejected, or unresolved against current source. The board closes with a short exchange recorded in the task's retrospective.

How a reviewer thinks, including the smell baseline, lives in the `code-review-specialist` role. The skill holds only the process.

## Evidence and authority

Every finding states its location, the broken standard or requirement, the trigger, the evidence, the impact, and the smallest fix, with severity critical, significant, or minor. The report lists confirmed findings, unresolved questions, and coverage limits per axis. The review reports; fixes follow only when the requester holds that authority.

Ralph remains an implementation loop. Run `code-review` after Ralph when independent review is warranted.
