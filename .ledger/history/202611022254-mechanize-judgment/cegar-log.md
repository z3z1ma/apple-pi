# Counterexample-to-test experiment

Outcome: complete in commits `346f6908` and `6c8a5c3f`. One review cancellation defect was reproduced and fixed; departure produced no counterexample within its finite bound. No implementation follow-up or runtime restart is requested by this record. TLC is the TLA+ state-space checker. A review generation identifies one admitted round of work; a departure generation identifies a person's session incarnation.

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

The fix changes only cancellation's final generation predicate. At the fix increment, existing comments in `review-jobs.ts` were left to Deniz's separate cleanup lane. No runtime restart is part of this experiment.

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

## Reproduce from the checkout

With the repository's development dependencies and Java available, run:

```sh
node scripts/run-tlc.mjs specs/review-lifecycle.tla
node scripts/run-tlc.mjs specs/departure-lifecycle.tla
npx vitest run tests/lifecycle-models.test.ts components/session-state/tests/review-cancel-race.test.ts --maxWorkers=1
```

Both current models and the implementation regression should pass. The archived pre-fix trace and red test are historical failures, not the expected current result. A future behavioral model counterexample needs its own real-code regression and report before a production fix; a TLC construction error needs model repair first.

## Maintainer follow-up review

The regression now observes the shared public `readReview` projection instead of raw SQL columns/fixed generation values. It requires the accepted additional-work question to remain queued and the assessment to stay unchanged after the older cancellation completes. Schema seeding and the timer seam remain fixture setup, not product assertions. The fixture's queue suppression and timer controls remain necessary to reproduce this particular public-command race without launching model work; the two CLI tests remain checks of models, not evidence that TypeScript satisfies them.

The revised public-reader assertion was executed against the pre-fix implementation in a disposable detached worktree at `346f6908^`: it failed on `queued` becoming `cancelled` and revision 2 becoming 3 (3.90s total, `/tmp/niamh-reflection-red.log`). The worktree and its owned dependency symlink were removed after checking their status. On current code, the revised regression plus both model checks passed 3/3 (6.17s, `/tmp/niamh-reflection-green.log`); Node/web types, scoped Biome and new-source comment checks passed. The first follow-up context lint reported one neighboring missing coupled path in `stored-drafts.ts.md` (`workplace-compose.tsx`), not a failure in these sidecars; the final rerun passed across 641 context files after that separate lane settled. Full-suite, installed-package and live-runtime claims remain unverified.

## Portability observations

- The portable operation is model -> retained trace -> ordinary implementation regression -> classify the result. Apple-pi's real runtime fixture, SQL schema and IPC scheduler are repository-specific test adapters, not part of the general skill or runner.
- The repository ignores `*.log`, including evidence inside the ledger. Retained evidence uses `.txt`; the first explicit staging attempt stopped on this ignore rule before committing. Record source/implementation revision and durable trace/config before changing a real defect. The runner's disposable TLC directory is useful operationally, but stdout/stderr must be retained outside it for the experiment record. Vitest emits a final extra blank line; trim that terminal whitespace and run the staged whitespace check after adding retained outputs. The final commit attempt first stopped on those blank lines before committing; the evidence assertions and timings are unchanged.
- Separate model construction errors from safety/liveness counterexamples. An emitted behavior after an incompletely specified action is not evidence of a production defect.
- A reported violation is only a candidate until the translated observable fails against actual code. Keep scheduler controls explicit and preserve real admission/transaction guards; a fake result would only reimplement the model.
- The general skill should specify the implementation oracle and classification explicitly: safety/liveness trace -> ordinary real-code test; failing intended assertion -> report before fix; passing intended assertion -> refine against source; setup/loader/model-construction errors -> repair the harness/model before classification. The runtime/SQL/IPC details belong to each repository's ordinary test adapter.
- The general skill should require time-to-candidate and time-to-clean-reproduction separately, including source reading and harness repair. A passing trace test calls for source-supported refinement, not weakening the implementation assertion. Stable command identities also need explicit single-admission/settled states: resetting a pending slot can silently model a different command rather than an exact retry.
- No runner code change was needed for either model: explicit spec/config paths, canonical module staging, real nonzero status and standard-library loading already work independently of the model's repository. Keep its current single-local-module limitation explicit. Retained output/config/source plus the project's regression command suffice for this loop; this experiment does not justify a new runtime, persistent checker database or generic test-adapter framework.
- Checkout-only Vitest commands and installed runner/spec commands remain distinct. Root's `0e13c4be` already clarified that installation boundary; this experiment leaves those shared guidance files untouched.

## Outside repository: async-mutex

Assignment: `work-b0b98c0e-f8e3-4baf-9ff4-e464540a8847`. Focused 2026-11-03 at **07:12:49 UTC** (task thread 8845). Used the portable skill at `216f2a49` and the existing bundled runner, with no apple-pi runtime, schema, IPC or test adapters. All times are elapsed wall-clock, including cloning, dependencies, source reading and setup repair.

### Target and contract

Cloned https://github.com/DirtyHairy/async-mutex at `b0bb4c5aa0e42eb5ffc8d9342e56bb6de1b95554` into `/tmp/niamh-cegar-async-mutex`. This is the MIT-licensed async-mutex 0.5.0 source. Chose its weighted semaphore because acquisition queues, priority-aware unlock observers and cancellation interact across promise boundaries; its local Mocha/ts-node tests run in milliseconds. The clone has no project `.context` or AGENTS files in its source root. Read README/API documentation, implementation and relevant existing tests instead of inventing an adapter.

The README at lines 453-455 promises that `waitForUnlock(weight, priority)` resolves as soon as acquisition with those arguments is possible. Its cancellation caveat preserves held locks; the counterexample has **no holders** and value 1 throughout.

### Semaphore model, trace and classification

Retained [model](cegar/async-mutex-semaphore.tla), [configuration](cegar/async-mutex-semaphore.cfg), [TLC trace](cegar/async-mutex-tlc.txt), [ordinary Mocha reproduction](cegar/async-mutex-cancel-unlock-observer.ts), [combined test output](cegar/async-mutex-tests.txt) and [upstream-ready report](cegar/async-mutex-report.md).

| Model action | Actual source at the recorded revision |
| --- | --- |
| AcquireHeavy | `src/Semaphore.ts:24-39`, acquire weight 2/priority 0 with free value 1: queue the request. |
| WaitLight | `src/Semaphore.ts:49-62` and `_couldLockImmediately` at 132-135: equal-priority head blocks an observer requesting weight 1, despite its weight fitting the free capacity. |
| Cancel | `src/Semaphore.ts:82-85`: reject queued acquisitions and clear `_queue`, leaving unlock observers unchanged. |
| Audit | Ordinary cancelled-acquisition and fresh `waitForUnlock(1,0)` promise barriers. Observe the earlier notification without timers, sleeps, private fields or scheduler mocks. |

`EligibleObserverNotStranded` checks the README's prompt eligibility notification at this observable barrier, not an invented deadline or a guarantee that an observer reserves a permit. The instance has one heavy acquisition, one existing light observer, one cancellation and one fresh observer; value/priority are fixed and there are no holders, releases or timeouts. TLC returns a five-state trace: initial -> heavy queued -> light observer pending -> cancellation clears heavy -> fresh observer can proceed but old observer is still pending. The search stops at this real invariant violation; it is **not** reported as a clean exhaustive run.

The implementation assertion fails at the same observable. A companion control calling `setValue(getValue())` dispatches the existing observer without increasing capacity. The finding was reported before any source fix (task thread 8873). Tadhg requested a suggested fix **described only**: after clearing the acquisition queue, notify newly eligible unlock observers using existing draining logic while preserving value and held permits. That change remains unapplied and unverified. No issue, PR or other upstream contact was made.

### Iterations and timing

| UTC / elapsed from focus | Change / evidence | Outcome |
| --- | --- | --- |
| 07:13-07:16 / first 3m | Clone, inspect contracts/source/tests, `npm install --ignore-scripts --no-audit --no-fund`, then ordinary semaphore baseline. | Host Node 26.7.0 failed in yargs before tests: `ReferenceError: require is not defined in ES module scope`. [Setup output](cegar/async-mutex-node26-setup.txt). Classified as setup, not a product defect. |
| About 07:16 / about 3m | Use Node 22 with the repository's existing Mocha TDD/ts-node configuration. | All 42 original semaphore tests passed in 14ms. |
| **07:18:08 / 5m19s** | Run the source-derived semaphore model from the **outside repository cwd**, passing its local spec path to the absolute bundled runner. | **Time-to-candidate:** TLC exit 12, `EligibleObserverNotStranded`, 14 generated/12 distinct states, depth 5, two still queued at the violation. |
| 07:19:37 / 6m48s | Translate the trace into the repository's own test framework, with one behavioral assertion and one value-dispatch control. | Intended assertion failed; control passed (3ms). Node 22 also emitted a nonfatal native-TypeScript module warning. |
| **07:20:05 / 7m16s** | Disable native TypeScript stripping so the project's existing ts-node registration owns TypeScript loading. Same test and assertion. | **Time-to-clean-reproduction:** one intended failure/one pass, 4ms, exit 1, without loader warnings or unrelated errors. |
| About 07:21 / about 9m | Run original semaphore suite and reproduction together, checking upstream `src` has no diff. | **43 passing / 1 intended failure**, 16ms. All 42 original tests and the positive control pass; the new observable assertion alone fails. |
| 07:28:38 / 15m49s | Optional second area: source-derived timeout/late-permit cleanup model, below. | 9 generated/8 distinct states, depth 5, no errors, complete queue and temporal-property check. |
| About 07:29 / about 16m | Existing `test/withTimeout.ts`, unchanged, through the same ordinary test framework. | **105 passing**, 26ms. No new counterexample to translate. |

### Second area: timeout compensation

[TimeoutRelease model](cegar/async-mutex-timeout.tla), [configuration](cegar/async-mutex-timeout.cfg), [TLC result](cegar/async-mutex-timeout-tlc.txt), [existing implementation tests](cegar/async-mutex-timeout-tests.txt).

`src/withTimeout.ts` sets a timer and awaits the underlying acquire. A late ticket after timeout is released instead of being returned to the rejected caller; an on-time ticket clears the timer and `runExclusive` releases it in `finally`. Modeled one unit permit, one original holder and one decorated request: inner grant, outer timeout, await continuation, callback entry/completion and permit return. `NoTimedOutCallback` and `PermitConservation` are safety claims. `LateGrantReturned` is conditional liveness: an already granted timed-out ticket is eventually returned **assuming weak fairness of the grant-handling microtask**. It does not assume the original holder eventually releases or that arbitrary user callbacks terminate. The model overapproximates timer/await ordering and excludes cancellation, weights, additional callers and crashes. No counterexample was found, and none was manufactured into a new test.

### Reproduce and portability result

From the retained clone:

```sh
node /Users/alexanderbut/code_projects/personal/apple-pi/scripts/run-tlc.mjs specs/semaphore-cancel.tla
npx --yes --package=node@22.23.4 node --no-experimental-strip-types node_modules/mocha/bin/mocha.js test/semaphore.ts test/cancel-unlock-observer.ts
node /Users/alexanderbut/code_projects/personal/apple-pi/scripts/run-tlc.mjs specs/timeout-release.tla
npx --yes --package=node@22.23.4 node --no-experimental-strip-types node_modules/mocha/bin/mocha.js test/withTimeout.ts
```

The first two commands intentionally fail for the recorded model invariant/implementation assertion; the second two pass. The runner path is this installation's bundled executable, not a copied implementation adapter. To reconstruct elsewhere, clone the recorded upstream revision, install its development dependencies, copy the retained model/config and Mocha test into that checkout, and invoke the installed runner by its own path. Recorded toolchain: Node 22.23.4 for Mocha, host Node 26.7.0 for the runner, Java 21.0.4, TLA+ 1.7.4/TLC 2.19, Mocha 10.3.0, ts-node 10.9.2, TypeScript 5.4.2 and tslib 2.6.2. `npm install` updated the clone's yarn.lock and created package-lock.json; source files remain unchanged. Those installed dependencies and lockfiles remain in the retained clone.

**No skill or runner fix was needed.** Explicit external spec/config paths, canonical module staging, safety failure status and a fair temporal property all worked unchanged. The setup friction belonged to the outside project's tooling under the host Node version; the skill's existing setup/loader classification handled it. This is one confirmed defect and one bounded positive model in one outside project, not a general portability or detection-rate claim. The standalone upstream-ready report contains the README promise, minimal test and unapplied suggested fix. The outside project's `tsc --noEmit` and ESLint on the new reproduction passed; retained local evidence/report links resolve. Terminal blank lines/trailing spaces in captured test output were normalized for repository whitespace checks without changing assertions, counts or traces. No apple-pi production source or test adapter was changed for this outside experiment.

Per Tadhg's follow-up direction (8874), **keep `/tmp/niamh-cegar-async-mutex` until the operator decides whether to file**. No clone deletion or upstream source fix is authorized by this record. No process or service was left running.
