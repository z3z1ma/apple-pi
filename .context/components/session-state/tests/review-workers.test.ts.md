## file

Real isolated runtime, Git capture and program-peer lifecycle; fixture peers use Pi's real SessionManager.forkFrom rather than append to an original worker. One fake bridge represents an awake worker; seeded retained sessions represent workers at home. The public review_code/manage_review path uses a real scripted SDK session. No paid model, shared runtime, UI badge or installed CLI process is exercised.

Foreign worker names and IDs are refused before capture. A worker moved while the review is queued cannot launch; reviewScope separately rechecks authority after attempt persistence, preserving operator authority. Runtime tests use actual public log projections to require new attempt text and exclude inherited worker text. Missing/incorrect offsets yield no entries, while output beyond the bounded tail still retains attempt-local results. The direct scope case seeds a launch-eligible persisted attempt only after actual peer cleanup; it tests that guard, not another process launch.
Coupled: components/session-state/src/program-fork.ts, components/session-state/src/protocol.ts
Verify: components/session-state/tests/review-workers.test.ts

Two supplied workers on three planned passes must bind by plan order despite parallel execution; planning remains a temp. A longer list leaves extra workers unused. Cancelled and failed/retried forks must lose every program scope/peer while the lasting people and original session bytes remain. No run_turn may target an original worker. read_review attempts and pass projections expose the same worker metadata, and a native fresh rerun retains the admitted worker IDs.

Review outcomes, full attempt identities/models, and rerun staffing are asserted through read_review's shared public projection, rather than raw review tables. Fork transcripts must retain the selected worker's history as well as leave the original bytes unchanged. Cancellation requires two worker attempts before checking their terminal states.
Why: checking only --fork arguments or original bytes can pass while losing inherited context; filtering a missing worker set and applying every() can pass vacuously when all passes accidentally use temps. Cleanup also probes every recorded fixture PID for ESRCH and keeps the original worker's stand-in process alive: empty ownership tables alone do not prove process exit. SQLite setup and program-ownership cleanup checks remain explicit fixture/lifecycle observations, not substitutes for the public outcome.

On baseline 1e734dde the initial four tests reached admission and failed because request.workers was rejected; this establishes the missing feature, not every downstream harness assertion. An earlier attempt failed on a seeded sessions NOT NULL setup error and was repaired before classifying red. Fork model assertions revealed that a later faux assistant message's model overrides an earlier model_change in SessionManager's restored context. Seed that message with the intended provider/model too; fauxAssistantMessage takes content and limited options, not model options.

Coupled: tests/fixtures/peer-pi.mjs, components/session-state/src/review-attempt.ts, components/session-state/src/review-jobs.ts, components/session-state/src/runtime.ts
Verify: components/session-state/tests/review-workers.test.ts
