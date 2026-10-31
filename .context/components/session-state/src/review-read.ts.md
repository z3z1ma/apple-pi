## file

These are read-only projections over the runtime's review records. Read a consistent SQLite snapshot when combining a job, its selected attempts and their reports. Keep selected completed coverage distinct from the full attempt history: a later failed attempt or a report from another plan is not automatically the current assessment. Finding handles include the actual attempt identity so a new allegation cannot silently inherit a decision attached to an earlier pass with the same local finding ID.

Organization scope follows the review's recorded root through the existing tree. Inventory roots from review_jobs, not tree.ts anchorsOf: that helper inventories work_tasks, and a completed review can survive after every temporary task was removed. A whole-root merge without surviving tasks reproduced this distinction. Request-handle lookup follows commands.result, then applies the same review authorization.

An inspection's completed claim does not override a validator's explicit coverage gap. Missing intent stays unassessed; captured intent is not passed intent. Zero findings, validated findings, coverage and execution state are separate observations. These projections do not establish live-checkout freshness or approval. In-flight phase can change without a new result revision; a result revision alone is not a live-progress cache key. Queue paging around a selected identity uses the same ordering and scope as the page itself, so a live reorder changes the page offset rather than silently selecting another review.

Coupled: components/session-state/src/review-jobs.ts, components/session-state/src/review-attempt.ts, components/code-review/src/results.ts, components/code-review/src/tools.ts
Verify: components/session-state/tests/review-queue.test.ts
