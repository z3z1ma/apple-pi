# Code Review

`code-review` is an optional risk-control skill, not an automatic lifecycle gate. Load it when the operator requests a review of a branch, pull request, working tree, or bounded diff:

```text
/skill:code-review
```

## Two independent axes

A complete review asks:

1. **Standards** — does the implementation follow the repository's documented conventions and engineering constraints?
2. **Intent / Spec** — does the change faithfully deliver the originating request, issue, task, or specification?

The axes use independent investigation contexts and remain separate in the report. A polished implementation cannot hide wrong behavior, and correct behavior cannot excuse a broken repository contract. Findings are verified and deduplicated within an axis, not ranked against the other axis.

When no Intent / Spec source exists, the report says that axis was not assessed. It does not call the missing evidence a pass.

## Review shapes

Use the cheapest sound topology:

1. **Root inspection** — one very small, narrow question.
2. **Flat direct-agent fan-out** — the normal complete review: one Standards lane and one Intent / Spec lane in parallel.
3. **Fixed-lens Pi Exec** — known independent risk questions with typed fan-in and candidate verification.
4. **Dynamic planned Pi Exec** — a planner partitions a broad or structurally uncertain change into focused investigations.
5. **Hierarchical or residual Pi Exec** — semantic partition reducers or one bounded second investigation wave when one trustworthy fan-in cannot carry the complete evidence.

Pi Exec is for a real graph, not merely because a change spans files. Two reducer layers require a semantic or actual context-fit boundary, never an arbitrary finding-count threshold.

The examples under [`skills/code-review/references`](../skills/code-review/references) are adaptable program bodies rather than hidden review engines:

- `plan-review-verify.js` — dynamic partitions and focuses;
- `multi-lens-review.js` — fixed independent lenses;
- `residual-review-loop.js` — one bounded verifier-directed coverage pass.

Load [`pi-exec`](../skills/pi-exec) before adapting a program. Pass the comparison explicitly. Planned and fixed-lens programs also require the axes the root intends to assess; pass applicable standards and intent source paths so reducers can inspect the governing evidence.

## Evidence and authority

Every finding establishes the changed location, reachable trigger, evidence chain, violated standard or intent, observable impact, and smallest correction direction. Reviewer, reducer, and verifier workers are read-only; their outputs are hypotheses. Failed lanes, truncation, omitted candidates, unknown IDs, and uncovered paths remain visible coverage failures.

The root independently checks candidates against current source and governing evidence, writes the final axis-separated report, and owns any checks. Code review is report-only unless the operator also requests or later authorizes fixes.

Ralph remains an implementation loop. Run `code-review` after Ralph when independent review is warranted rather than embedding a duplicate review controller inside Ralph.

See [`skills/code-review`](../skills/code-review) for the full procedure and [`docs/exec.md`](exec.md) for Pi Exec composition.
