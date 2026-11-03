# Counterexample-to-test experiment

Owner: Niamh Virtanen. Assignment: `work-42e81213-eee7-4093-bd21-7977954031dd`.
Started 2026-11-03 at 06:27:47 UTC (task focus, thread sequence 8720). Times below are wall-clock observations, not provider/CPU effort. Work runs on main in the shared checkout; no live daemon restart or paid model turn.

## Review lifecycle: one confirmed defect

### Boundary and source mapping

`specs/review-lifecycle.tla` models the asynchronous cancellation/admission boundary in `ReviewJobs.execute`, not the semantic quality or full execution of reviewer attempts. Two independent cancel requests can await one attempt's program cleanup. `waitCleanup` polls recorded program scopes independently for each request. `extend` verifies a retained artifact, checks state/generation/owner/revision/digest, and admits a new question on a new generation. Queue execution may wait behind other jobs. Existing source context already requires resume/extend to retain observed authority across asynchronous verification.

The original cancellation completion differed: its final UPDATE checked only job id. It could overwrite a later authorized generation. The abstract pending map records the generation observed by each cancellation; `NoStaleCancellation` forbids changing job state for a newer generation. Bound: two cancellation identities, one extension, generations 1 and 2, one retained artifact, one cleanup dependency. No fairness or eventual-completion claim.

### Iterations

| UTC / elapsed from focus | Model or test change | Trace / executable test | Result and duration |
| --- | --- | --- | --- |
| 06:32:13 / 4m26s | Initial source-derived review model. | TLC reported an incompletely specified successor, not an invariant violation: a disjunction on an assignment's right side lacked parentheses. | Construction error, exit 75; corrected expression before interpreting model output. No product counterexample claimed. |
| 06:32:35 / 4m48s | Parenthesized the assignment; no behavioral refinement. | `NoStaleCancellation`, six states: incomplete/gen1 -> cancel A waits -> cancel B waits -> A completes/cancelled/gen1 -> extend/queued/gen2 -> B completes/cancelled/gen2. [Exact pre-fix model](cegar/review-before-fix.tla), [config](cegar/review-before-fix.cfg), [trace](cegar/review-counterexample.txt). | TLC exit 12; 22 generated/16 distinct states, four still queued at violation, depth 6. First model lead, not yet a confirmed implementation defect. |
| 06:38:47 / 11m00s | Translated the trace into actual Runtime/socket/SQLite commands with an actual captured Git artifact. Held only the two cleanup polling timers and queue wake. | First in-process regression reached the final expected `queued/gen2` assertion and observed `cancelled/gen2`. | Expected failure: 1.17s test/2.39s total. Also emitted unrelated transcript-worker module-loader noise; not accepted as the final clean reproduction. |
| 06:40:27 / 12m40s | Moved the same scenario into `fixtures/review-cancel-runtime.ts`, forked with ordinary `register.mjs`. | [Registered child-runtime red result](cegar/review-red-test.txt). Both cancels and the intervening revision/digest-bound extension applied. Child stderr was empty. | Expected failure at the same assertion: 2.34s test/3.56s total. Clean time-to-confirmed-defect: about 12m44s, including source reading, model construction and harness repair. |
| 06:41-06:42 / about 14m | Reported trace/red test before fixing (task thread 8749, 8755); Tadhg authorized generation binding (8750); Deniz released this one source file (8754). Bound final cancellation UPDATE to the original generation; superseded completion remains an applied no-op. Updated model's FinishCancel to the same conditional update. | Same unweakened test; no change to expected queued/gen2 outcome. | Green 1/1: 2.27s test/3.31s total. Updated TLC exhaustive search: 34 generated/20 distinct, zero queued, depth 7, no error. |

### Proof limits

The regression uses a real isolated child Runtime, public commands, real SQLite transactions and actual artifact integrity verification. It seeds an incomplete review and previous attempt/scope; removing that scope represents successful earlier cleanup. IPC independently releases actual `waitCleanup` polling timers, a feasible ordering of two independent polls around an intervening command. Queue wake alone is suppressed so no reviewer/model launches; the queue is observed before its worker claims it. This proves the cancellation mutation race, not actual reviewer process cleanup, arbitrary scheduling, semantic review quality or live activation.

The fix changes only cancellation's final generation predicate. Existing comments in `review-jobs.ts` remain Deniz's separate cleanup lane. No runtime restart is part of this experiment.

### Review increment validation

- Final strengthened regression also preserves assessment revision and the admitted additional-work payload across the superseded completion: 1/1 passed, 2.33s test/3.34s total (`/tmp/niamh-cegar-review-final.log`).
- Focused regression plus existing cancellation/additional-work selections: 5 passed, 37 skipped across two files, 18.71s (`/tmp/niamh-cegar-review-focused.log`).
- `npm run typecheck`: Node and web passed after adding explicit timer-fixture parameter types (`/tmp/niamh-cegar-types-1.log`).
- Scoped Biome on the source/test/fixture, comment check on new TS test/fixture, and scoped whitespace checks passed. Existing source comments remain a separate assigned migration, not a comment-clean claim about this source file.
- `context_lint`: 586 context files passed at this increment. Full suite and live activation were not run.

## Departure lifecycle

Pending the second source-derived model and TLC run.

## Portability observations so far

- The portable operation is model -> retained trace -> ordinary implementation regression -> classify the result. Apple-pi's real runtime fixture, SQL schema and IPC scheduler are repository-specific test adapters, not part of the general skill or runner.
- The repository ignores `*.log`, including evidence inside the ledger. Retained evidence uses `.txt`; the first explicit staging attempt stopped on this ignore rule before committing. Record source/implementation revision and durable trace/config before changing a real defect. The runner's disposable TLC directory is useful operationally, but stdout/stderr must be retained outside it for the experiment record.
- Separate model construction errors from safety/liveness counterexamples. An emitted behavior after an incompletely specified action is not evidence of a production defect.
- A reported violation is only a candidate until the translated observable fails against actual code. Keep scheduler controls explicit and preserve real admission/transaction guards; a fake result would only reimplement the model.
- The general skill should require time-to-candidate and time-to-clean-reproduction separately, including source reading and harness repair. A passing trace test calls for source-supported refinement, not weakening the implementation assertion.
- Checkout-only Vitest commands and installed runner/spec commands remain distinct. Root's `0e13c4be` already clarified that installation boundary; this experiment leaves those shared guidance files untouched.
