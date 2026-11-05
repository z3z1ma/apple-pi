Status: in-progress
Created: 2026-11-04
Updated: 2026-11-04

# Code review: why reviews fail, run incomplete and take long

## Intent

Operator, 2026-11-04: the captured code review fails at random, often ends incomplete and takes too long; it should plan, fan out and fan in faster than one agent reviewing by hand, with more accuracy and fewer review cycles. Find what is redundant or overkill from the recorded reviews (`analysis.md`), then, after his approval of all five proposals, implement them. He also suggested giving reviewers tools whose inputs are exactly the structure wanted, instead of free-form output with bookkeeping.

## Acceptance

- Bookkeeping cannot fail a review: harness-filled artifact and pass, exact per-attempt result tools, one retry, a pass that fails twice leaves the review incomplete with the other work kept.
- The integration pass is never asked to reconcile reports it cannot see.
- Evidence that this machine cannot produce is a stated limit, not an incomplete review.
- No per-report validation; duplicates are still linked when there are two or more findings.
- The planner runs at medium thinking; a restart resumes queued or running reviews whose source verifies.
- Focused runtime, contract, reader, UI and backend tests pass; docs and context files describe the new pipeline.

## Current State

Implemented (9480a9f5), activated with the operator's consent (runtime pid 6361, Workplace relaunched), exercised by one live review of itself, and corrected from that review (fa877d66, not yet activated: the runtime still runs 9480a9f5).

Live review `review-2b3746d1-3241-47a1-bb1d-e2e2ce9b98dd` of 9480a9f5: completed in 12.5 minutes (planner 1.9 minutes at medium thinking, slowest pass 10 minutes, linking 0.4 minutes; no per-report validation). 13 findings, 3 linked as duplicates, 10 distinct; all 10 answered fixed-claimed in fa877d66 with regressions where practical (owner reassignment during recovery and failed program opening with retained cleanup are fixed from source reading, not reproduced). It also exposed that storing only the links crashed every Pi session started before the change when it read that review; the merge now stores the whole assessment.

- Result tools: `planToolSchema`, `reportToolSchema`, `duplicateToolSchema` with `*FromTool` converters (`components/code-review/src/contracts.ts`). This applies the operator's suggestion through the existing per-turn structured result tool (`pi_exec_return`, registered per request with the attempt's schema): Pi validates arguments in the turn and returns errors to the model, so no new extension or environment flag was needed. Separate incremental tools (one call per finding or answer) were considered and not built: the exact schema already removes the bookkeeping that failed, and the recorded failures were all identity mismatches, not oversized results.
- Pipeline (`components/session-state/src/review-jobs.ts`): retry once, `ReviewStop` for unretriable failures, per-pass failure kept local, merge only for two or more findings, reasons listed per cause, unavailable answers reported, automatic resume after restart, planner at medium thinking.
- Reader: status derived from reports and links (`assessFindings`), legacy validations read as stored.
- Checks: `review-queue.test.ts` 42/42 including new cases (unsettled question and twice-failed pass, unavailable evidence with the exact tool schema, automatic resume and damaged target), `components/code-review/tests`, review cancel and wait tests, operator pages, captured sign-off page, Workplace reviews backend and browser tests, typecheck and Biome on changed files.
- Not verified: a real paid review on the new pipeline; the time and completion figures in `analysis.md` are projections from recorded reviews.

## Outcome

Pending.
