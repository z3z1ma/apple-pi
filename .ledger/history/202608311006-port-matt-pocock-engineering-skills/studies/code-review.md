# Code review

Source: `mattpocock/skills` at `6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`

Status: approved; implementation and validation complete

## Target

Consolidate upstream `code-review` into Apple Pi's review fundamental and rename the sole public skill to `code-review`. Preserve upstream's pragmatic comparison, standards, specification, smell, and independent-axis workflow while retaining Apple Pi's evidence standard, root authority, coverage accounting, and optional Pi Exec review graphs.

## Operator decisions

1. Rename `review` to `code-review`; leave no compatibility alias.
2. Retain essentially all upstream pragmatic review doctrine rather than treating the skill as only a Pi Exec guide.
3. Preserve dynamic planner fan-out, fixed independent lenses, typed fan-in, and optional two-layer reduction as powerful Pi Exec patterns.
4. Use direct agents for a flat independent fan-out; use Pi Exec when planning, typed reduction, branching, residual work, or hierarchical fan-in adds a real graph.
5. Remove the duplicated `ralph-ledger-review.js` controller. Ralph remains implementation-only by default, followed by a caller-owned `code-review`.

## Fidelity accounting

The merged skill preserves:

- a pinned and validated comparison boundary before delegation;
- merge-base semantics for branch/PR review plus working-tree and untracked-file coverage when requested;
- ordered discovery of originating issue/specification/intent without inventing one;
- repository standards plus the complete twelve-smell baseline;
- repository override, judgment-call, and tooling qualifications for smells;
- independent Standards and Intent/Spec axes;
- isolated reviewer contexts;
- separate within-axis reconciliation, ranking, coverage, and worst-issue reporting;
- explicit not-assessed semantics when no Intent/Spec source exists;
- the two examples showing why one passing axis cannot hide the other failing axis.

Apple Pi retains:

- a material finding contract covering changed location, reachable trigger, evidence, violated contract, observable impact, and smallest correction;
- read-only planner/reviewer/reducer/verifier workers whose output remains advisory;
- root-owned source verification, checks, mutation authority, and final reporting;
- explicit failed-lane, truncation, omission, candidate-ID, and coverage failures;
- no arbitrary finding or residual-gap caps;
- report-only behavior unless the operator requests or authorizes fixes.

## Topologies

1. Root-only inspection for one very small narrow question.
2. Flat direct-agent Standards and Intent/Spec fan-out for a normal complete review.
3. Fixed-lens Pi Exec when known lenses need typed fan-in and independent verification.
4. Dynamic planned Pi Exec when the change needs semantic partitioning and generated focuses.
5. Two reducer layers only when actual context fit or semantic partitioning prevents one trustworthy fan-in: focused lanes to partition/axis reducers to a final axis reducer. A residual second wave investigates verifier-identified material gaps without recursive self-expansion.

## Reference consolidation

Retain:

- `references/smell-baseline.md`
- `references/planner.md`
- `references/reviewer.md`
- `references/verifier.md`
- `references/plan-review-verify.js`
- `references/multi-lens-review.js`
- `references/residual-review-loop.js`

Remove `targeted-review.js`; one question does not earn a packaged graph. Remove `security-baseline-review.js`; attacker/defender is a fixed multi-lens configuration.

All retained programs use one axis-aware candidate/decision contract. The implementation also corrects the four stale verifier-schema families, invalid callback use in serialized reference examples, the arbitrary three-gap residual cap, and silent candidate omission risk. Function selectors remain a supported `std.context.pack` API; the retained examples use serializable field names for clarity.

## Integration

Rename `skills/review/` to `skills/code-review/` and `docs/review.md` to `docs/code-review.md`. Update README, package/runtime tests, provenance, boundaries, Ralph references, and live paths. Historical ledger records are not rewritten.

## Validation

Completed reference syntax and contract checks, loader discovery with a negative old-name assertion, package inclusion, focused runtime/package tests, documentation-link checks, and `git diff --check`.
