# Captured reviews: where the time goes and why they fail

The operator found captured code reviews (`review_code`) slow and saw them fail or end incomplete for reasons he could not follow. This analysis measures every review run so far to find what is redundant, brittle or overkill, so the tool can plan, fan out and fan in faster than one agent reviewing by hand, without losing accuracy.

Baseline pipeline on 2026-11-04, before `9480a9f5` (`components/session-state/src/review-jobs.ts`): a **planner** splits the change into scopes and passes, each with questions. **Focused** passes inspect one scope each, and one **integration** pass inspects the whole change; all run in parallel and never see each other's reports. When every inspection has ended, a **per-pass validator** challenges each report, confirming or rejecting its findings and recording **coverage gaps** (questions whose evidence it judges insufficient). Finally a **merge** attempt links duplicate findings across reports. A review ends **incomplete** if any question is incomplete, any gap is recorded, or a pass asks for more work; it ends **failed** if any attempt throws.

Source: every row in `review_jobs` and `review_attempts` of the live session-state database on 2026-11-04 (28 reviews, 26 planned). The query scripts were scratch files in `/tmp` and are not retained; each figure below names the table fields it came from where that is not obvious.

## Outcomes

| State | Reviews |
| --- | --- |
| completed | 8 |
| incomplete | 9 |
| failed | 5 |
| cancelled | 5 |
| no-changes | 1 |

Of the 22 reviews that ran to an end, 8 completed (36%).

## Time

Time to the last attempt's end (not `updated_at`, which later finding responses move): median 19 minutes, range 9 to 47.

| Phase | Runs | Median | p90 | Notes |
| --- | --- | --- | --- | --- |
| planner | 26 | 3.4 min | 5.1 | one attempt |
| focused | 82 | 8.6 min | 11.5 | parallel, up to 8 |
| integration | 23 | 8.3 min | 12.0 | parallel with focused |
| per-pass validation | 61 | 3.1 min | 4.2 | parallel, starts after every inspection ends |
| merge (duplicate linking) | 19 | 0.9 min | 8.4 | one attempt |

Critical path of a typical review: plan 3.4 + slowest inspection about 10 + validation about 3.5 + merge 1, about 18 minutes. Peer start-up and clean-up add seconds, not minutes. Inspections make 15 to 40 tool calls each; the time is model turns. Recent reviews are faster (inspections 2 to 5 minutes) than the first ones (8 to 15).

## Why reviews end incomplete

Every incomplete review carries the same reason; the cause is in the merge validator's `coverageGaps`. All 24 gaps came from the per-pass validators (the inspectors themselves marked one). By cause:

- **Asked for something the design forbids (7 gaps, in 7 of 9 incomplete reviews).** 23 of 26 plans tell the integration pass to "reconcile" or "challenge" the focused reports. The integration pass runs in parallel with them, sealed from their reports, and the inspection prompt tells it to work independently. Validators then record that it did not reconcile. Source: the planner prompt's line "The integration pass owns cross-scope interactions and challenges to this decomposition" (`components/code-review/src/prompts.ts`).
- **Evidence the environment cannot produce (about 9 gaps).** Live GitHub delivery, local Airflow with Docker absent, Terraform without a darwin_arm64 provider, a pre-existing failing fixture suite. Nothing more is possible without a person, yet the review is marked incomplete.
- **Validator stricter than inspector (about 8 gaps).** The inspector marked a question completed; the validator judged its evidence thin (for example stop and resume not exercised across an idle interval). Genuine, but small.

If the first two causes were reported as limitations instead of gaps, 4 of the 9 incomplete reviews would have completed.

## Why reviews fail

| Cause | Reviews |
| --- | --- |
| A model wrote a coverage row or gap whose question did not match a planned question ID exactly | 3 (plus one failed attempt that cancelled its siblings and needed a manual resume) |
| Provider safety filter on lens wording | 1 |
| The validator echoed a different artifact digest | 1 |

Two of the unknown-question failures are the same invented row, "Applicable (repository) standards and captured intent": the inspection prompt says "Cover the applicable repository standards and captured intent", and the model added that as a coverage question. `validateReport` and `validateFindings` throw on any unknown ID, and the first failed pass aborts the whole review. Nothing retries.

Runtime restarts (development of this harness) interrupted 5 attempts; those reviews needed an explicit resume.

## What validation adds

- Per-pass validators settled 106 findings: 106 confirmed, 0 rejected, 0 unresolved, 0 dropped. Their only effect on outcomes was the coverage gaps above.
- The merge linked 46 duplicates among 174 findings. That is useful.
- Per-pass validation costs about 3.5 minutes of the critical path (about 20%) and $20 of $228 recorded spend (about 9%).

Caveat: zero rejections may partly reflect that inspectors know they will be validated and must show evidence; the sample is 26 plans from one operator's repositories.

## Historical proposals (subsequently implemented; see task.md)

1. **Stop failing on bookkeeping.** The runtime fills the artifact digest and pass name itself; a coverage row or gap whose question does not match a planned ID becomes a limitation, not an error; a failed pass is retried once, and a pass that fails again is marked incomplete while the other passes keep their results.
2. **Remove the contradiction.** The planner prompt tells the integration pass to work independently on cross-scope interactions; reconciling reports belongs to the merge.
3. **Separate "could not run here" from "missed".** Environment-blocked evidence becomes a limitation shown first; only missed evidence makes a review incomplete.
4. **Drop per-pass validation and keep the merge**, or, as a middle option, validate only findings that rest on inference rather than an executed reproduction.
5. Optional: a lower thinking level for the planner (unmeasured, perhaps 1 to 2 minutes), and automatic resume after a runtime restart once the captured artifact verifies.

Expected effect of 1 to 4 on these 22 reviews: 4 of 5 failures and 4 of 9 incomplete outcomes would not have happened (16 completed instead of 8), and the typical critical path drops from about 18 to about 13 or 14 minutes. Recommended: 1 to 4 with plain removal in 4.

## Measured after the change (2026-11-05)

Three live reviews on the new pipeline, one sample each.

| Review | Target | Running time | Cost | Outcome | Distinct findings |
| --- | --- | --- | --- | --- | --- |
| ce9b98dd | 9480a9f5 (the pipeline change) | 12.5 min | $6.80 | completed | 10, all valid, fixed in fa877d66 |
| 468bcb1b | 0cd8c723 (Alloy/Lean tools), A/B against fbab8925 | 10.3 min | $5.94 | completed | 14, all real |
| 3b9c43e6 | 9480a9f5^..d1629539 (cumulative) | 10.9 min (plus 10.4 min queued behind 468bcb1b) | $6.57 | completed | 5, all valid; 4 fixed in 8eff6bc2, 1 awaiting the operator |

A/B on identical input (commit 0cd8c723). The old pipeline (fbab8925) took 18 minutes, cost $7.51, ended incomplete and reported 17 confirmed findings (16 distinct; all real, all fixed later). The new pipeline found 12 of those 16 clearly, 3 partly (open-namespace name resolution, quoted-name parsing, Lake timeout ordering) and missed 1 (Alloy receipt and exit-status checks). It also found 3 real defects that the old pipeline found only in its second and third review rounds (project kernel replay, `debug.skipKernelTC` proving False, concurrent first-use download paths). Every one of its 14 findings matches a defect that was later fixed: no false positives. One sample per pipeline; model variation between runs is not measured.
