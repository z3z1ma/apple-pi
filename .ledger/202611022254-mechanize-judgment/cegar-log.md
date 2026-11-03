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

At final inspection (06:59 UTC), bounded each cancellation identity to one admission with a distinct settled sentinel, matching command-journal deduplication instead of permitting reuse of a completed slot. The original six-state defect trace already uses each identity once, so the finding and implementation regression are unchanged. The final current review model exhausts 22 generated/17 distinct states, zero queued, depth 6: [final TLC output](cegar/review-final-tlc.txt). The retained pre-fix model/trace remains exactly as originally executed.

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

### Boundary and source mapping

`specs/departure-lifecycle.tla` models one permanent identity, a known original writer and one rejected late writer. The optional handoff path and explicit no-handoff path share the permanent marker and cleanup contract.

| Model actions | Actual owners / contract |
| --- | --- |
| Accept, ArriveWork, FinishWork, Reply, ReplaceIncarnation, Commit, Refuse | `Runtime.departureCandidate` and `Runtime.retireSession`: admission and second responsibility check, generation-bound final reply, fsynced handoff before atomic permanent marker; precommit changes can refuse departure. |
| CloseReceipt, WriterExits, ResolveProcessKnowledge | `Runtime.stopDepartureWriters`: a close/ended incarnation is not OS death; unknown observations block deletion. Stable PID/start identities are abstract writer keys; signal/pane mechanics are outside the model. |
| LateHello | `Runtime.rejectDepartureHello`: permanent identity cannot rejoin; a rejected producer adds a narrow writer/file obligation and advances the journal watermark. The action remains possible after an earlier truthful applied receipt. |
| BeginCleanup, ProveWritersStopped, RetryCleanup | `Runtime.cleanDeparture`, `departureWriters`, `departureWatermark`: snapshot known observations, prove writers stopped, invalidate and retry after new writer/binding evidence. |
| Unlink, RepairHeader | `removeDepartureFiles`: asynchronous header read, exact session identity, ownership recheck immediately before synchronous unlink; mismatches preserve files until repaired. |
| RemoveAndApply | `Runtime.cleanDeparture`, `removeDepartureRecords`: ownership-checked private-record transaction and terminal completion, separate from already-unlinked files. |
| Crash, Restart | `Runtime.recoverRetirements`: interrupted precommit jobs fail for inspection; committed cleanup resumes without another final turn. Repeated logical crashes are cycles, not a crash-count cap. |

Checked claims: `TypeOK`, `NoCommitWithWork`, `NoMissingHandoff`, `NoReopen`, `NoUnsafeDeletion`, `CompletionHasCleanup`. Completion records earlier successful cleanup; it does not promise that no late rejected producer can ever appear again.

### Iterations

| UTC / elapsed for departure work | Model or test change | Trace / executable test | Result and duration |
| --- | --- | --- | --- |
| About 06:47-06:51 / 4m | Read current departure helper, admission, commit, late-hello and cleanup owners and their context; wrote the source-derived model. | First TLC run (06:51:13) reported a missing `UNCHANGED obligations` frame in Commit, not a safety violation. | Construction error, exit 75. Added that frame; also restricted the modeled work-completion journal action to a running daemon. No product counterexample claimed. |
| 06:52:03 / about 5m | Corrected model frames; no production edit. | [TLC output](cegar/departure-tlc.txt). | Exhausted 18,172 generated/4,944 distinct states, zero queued, depth 18; TLC about 1s. No safety counterexample, hence no trace-derived new implementation test. |
| 06:52:41 / about 6m | Ran existing implementation controls corresponding to modeled boundaries: live SDK host after shutdown, same-process SDK replacement, responsibility arriving during handoff (dependent and independent), matching/mismatched transcript headers. | [Behavioral test result](cegar/departure-behavior-tests.txt). | 6 passed/25 skipped across two files, 26.42s tests/32.44s total. These are separate positive controls, not counterexample translations or a complete refinement proof. No scratch/live daemon restart selection was run. |
| 06:54:58 / about 8m | Added checkout-only automated checks for both current finite models; reran the review implementation oracle. | Initial automatic run passed. After the review identity-bound refinement, reran the same two files at 06:59:35: [final result](cegar/models-tests.txt). | Both runs 3/3 passed; final run 9.66s total. |

### Departure proof limits

Two observed cooperative writer identities are not an arbitrary-population theorem. SQLite commits and handoff fsyncs are assumed durable; crashes here are logical transitions, not physical power-loss tests. Other identity fields (role/team/transcript path), manager/temporary-person authorization, arbitrary process/PID reuse, tmux/OS signaling, private-field redaction, sidecar path sanitization, external/adversarial file replacement and unobserved writers remain outside this model. The source's exact resource proofs are stronger and more detailed than these abstract keys. No fairness assumption, eventual cleanup claim or paid/native model evaluation was made.

## Experiment result and final checks

One behavioral TLC counterexample was generated, translated and confirmed as a real defect. It was reported before the authorized fix. Both finite current models now exhaust their state spaces; departure yielded no behavioral counterexample. Two model-construction errors were caught and corrected; they are not defect yield. No counterexample translated to a passing implementation test, so this run exercised the confirmation arm, not an observed spurious-counterexample refinement arm. The result is evidence of usefulness in this case, not a general defect-detection rate.

- Review fix and first evidence increment: verified commit `346f6908` (12 owned paths). `review-jobs.ts` and its context were released back to Deniz afterward; subsequent comment-only migration is his ownership.
- Final Node and web typecheck passed (`/tmp/niamh-cegar-types-final.log`). New test/fixture Biome and source-comment checks passed; scoped whitespace check is recorded at final commit.
- Shared `context_lint` at 06:55 observed 613 files and three unrelated missing symbols in concurrently migrated browser-pages sidecars: `code-review.ts` / `sameRename`, `saved-page.ts` / `savedPage`, `web/ledger/graph.ts` / `layoutTickets`. Root was notified; no neighboring source/context was changed. Final rerun observed the same three issues across 616 files. The earlier review increment's 586-file lint was clean.
- Full suite, paid model, installed-package execution, physical crash testing and live activation were not run. All owned child runtimes exited and their temporary state directories were removed by the test finalizers.

## Portability observations so far

- The portable operation is model -> retained trace -> ordinary implementation regression -> classify the result. Apple-pi's real runtime fixture, SQL schema and IPC scheduler are repository-specific test adapters, not part of the general skill or runner.
- The repository ignores `*.log`, including evidence inside the ledger. Retained evidence uses `.txt`; the first explicit staging attempt stopped on this ignore rule before committing. Record source/implementation revision and durable trace/config before changing a real defect. The runner's disposable TLC directory is useful operationally, but stdout/stderr must be retained outside it for the experiment record. Vitest emits a final extra blank line; trim that terminal whitespace and run the staged whitespace check after adding retained outputs. The final commit attempt first stopped on those blank lines before committing; the evidence assertions and timings are unchanged.
- Separate model construction errors from safety/liveness counterexamples. An emitted behavior after an incompletely specified action is not evidence of a production defect.
- A reported violation is only a candidate until the translated observable fails against actual code. Keep scheduler controls explicit and preserve real admission/transaction guards; a fake result would only reimplement the model.
- The general skill should specify the implementation oracle and classification explicitly: safety/liveness trace -> ordinary real-code test; failing intended assertion -> report before fix; passing intended assertion -> refine against source; setup/loader/model-construction errors -> repair the harness/model before classification. The runtime/SQL/IPC details belong to each repository's ordinary test adapter.
- The general skill should require time-to-candidate and time-to-clean-reproduction separately, including source reading and harness repair. A passing trace test calls for source-supported refinement, not weakening the implementation assertion. Stable command identities also need explicit single-admission/settled states: resetting a pending slot can silently model a different command rather than an exact retry.
- No runner code change was needed for either model: explicit spec/config paths, canonical module staging, real nonzero status and standard-library loading already work independently of the model's repository. Keep its current single-local-module limitation explicit. Retained output/config/source plus the project's regression command suffice for this loop; this experiment does not justify a new runtime, persistent checker database or generic test-adapter framework.
- Checkout-only Vitest commands and installed runner/spec commands remain distinct. Root's `0e13c4be` already clarified that installation boundary; this experiment leaves those shared guidance files untouched.
