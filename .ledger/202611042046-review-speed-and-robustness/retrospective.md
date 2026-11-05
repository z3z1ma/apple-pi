Status: pending
Created: 2026-11-04
Updated: 2026-11-04

# Retrospective

## What Mattered

Pending completion of the undertaking.

## Learnings

- The analysis (`analysis.md`) came from the review tables in the session-state database, not from impressions: per-report validators confirmed 106 of 106 findings and produced every gap that made a review incomplete; 23 of 26 plans asked the sealed, parallel integration pass to reconcile focused reports it cannot see; exact question-ID matching after the turn, plus fail-fast cancellation, caused most failures.
- To check that a pipeline change did not cost accuracy, `manage_review` `rerun` on an old commit-target review gives an A/B on the same input, and the old review's later-fixed findings serve as ground truth. On `0cd8c723` the new pipeline took 10.3 min and $5.94 and completed, against 18 min, $7.51 and incomplete. It found 12 of the 16 old defects clearly, 3 partly and missed 1, found 3 that the old pipeline needed two more rounds for, and had no false positives. That is one sample each; model variance is unmeasured.
- Restarting the runtime to activate a change interrupted another owner's running review, because the active-review check and the restart were one command. Automatic resume rescued it (about 3 minutes rerun). The restart must depend on the check.
- Sessions started before a stored-shape change crashed reading new records; the merge now stores the whole assessment so the previous reader keeps working (see the `review-read.ts` and `review-jobs.ts` context files).
- Contributor PR z3z1ma/apple-pi#2 was superseded by this work, but its same-turn correction test covered a path nothing else did; it was adapted as `1561116b`. Read superseded contributions for tests worth keeping before closing them.

## Improvements

Pending completion of the undertaking.
