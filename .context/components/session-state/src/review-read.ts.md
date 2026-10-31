## file

These are read-only projections over the runtime's review records. Read a consistent SQLite snapshot when combining a job, its selected attempts and their reports. Keep selected completed coverage distinct from the full attempt history: a later failed attempt or a report from another plan is not automatically the current assessment. Finding handles include the actual attempt identity so a new allegation cannot silently inherit a decision attached to an earlier pass with the same local finding ID.

Organization scope follows the review's recorded root through the existing tree. Inventory roots from review_jobs, not tree.ts anchorsOf: that helper inventories work_tasks, and a completed review can survive after every temporary task was removed. A whole-root merge without surviving tasks reproduced this distinction. Request-handle lookup follows commands.result, then applies the same review authorization.

An inspection's completed claim does not override a validator's explicit coverage gap. Missing intent stays unassessed; captured intent is not passed intent. Zero findings, validated findings, coverage and execution state are separate observations. These projections do not establish live-checkout freshness or approval. In-flight phase and cost observations can change without a new result revision; a result revision alone is not a live-progress cache key. Queue paging around a selected identity uses the same ordering and scope as the page itself, so a live reorder changes the page offset rather than silently selecting another review.

Cost sums all recorded attempts, not only selected coverage: failed/cancelled turns and earlier plans consumed observed usage too. Reuse refers to an existing attempt rather than charging it twice. Missing, invalid or nonfinite observations are not zero; a nonfinite aggregate is unavailable even when individual observations exist. No attempts is the distinct zero-cost case. These are correlated primary-turn reports, not provider invoices or all internal activity. Keep the observation counts beside the amount.

The cost projection reads JSON text with SQLite's -> operator, then validates the parsed number. Numeric json_extract crosses Node SQLite's safe-integer binding boundary and threw on a recorded 2**53 value; JSON text preserves the producer's JavaScript number semantics and the distinction between numeric and string-valued cost.

readReviewSource authorizes and copies the admitted artifact before asynchronous Git work, with no SQLite read transaction held across that work. File inventory and file-line pages use the same explicit paging rules; binary/pointer-only representations have no invented line count. Availability in captured source does not imply independent inspection, whole materialized-copy integrity, or live applicability.

Freshness separately observes the requested comparison, current checkout and policy, with timestamps/errors and no claim of atomicity. It copies authorized identity/policy in a read snapshot before asynchronous captures. The optional explicit store supports the Electron adapter without redirecting reads into ambient state; no database transaction spans source acquisition.

Coupled: components/code-review/src/capture.ts, components/session-state/src/review-jobs.ts, components/session-state/src/review-attempt.ts, components/code-review/src/results.ts, components/code-review/src/tools.ts, components/code-review/src/presentation.ts
Verify: components/session-state/tests/review-queue.test.ts
