# Review

Review is an optional risk-control skill, not an automatic lifecycle gate. The root agent normally inspects bounded changes directly and already benefits from the persistent Sentinel.

Load `/skill:review` when the operator requests an end-to-end defect-focused review. During ongoing implementation, use `review-commissioning` only when a concrete costly or hard-to-observe risk warrants an independent reviewer.

```text
/skill:review
```

## Choose the cheapest useful shape

1. **Root inspection** — default for bounded changes.
2. **One independent reviewer** — one complete assignment for a meaningful integrated risk.
3. **Multiple independent lenses** — exceptional security, migration, compatibility, or other genuinely separate high-risk contracts.

The programs under [`skills/review/references`](../skills/review/references) remain available as advanced starting points. They are not the default and should not be selected merely because a change spans files.

## One-pass behavior

Give a commissioned reviewer the intended behavior, changed paths, comparison boundary, relevant contracts, checks already run, and all important risk questions in one call. Findings must establish patch causality, a reachable trigger, evidence, observable impact, and a bounded correction.

The root agent validates the findings and makes ordinary fixes itself. Nits conclude in the root. A scoped follow-up serves a material high-risk fix that remains difficult to verify from code and tests. Planner/reviewer/verifier and residual topologies remain exceptional tools.

See [`skills/review`](../skills/review) for finding semantics and [`docs/exec.md`](exec.md) for optional `pi_exec` composition.
