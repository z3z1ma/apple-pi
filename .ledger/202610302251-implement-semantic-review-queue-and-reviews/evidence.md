# Implementation evidence

## Capture foundation (in progress)

Implemented personally in `components/code-review/`. At this capture checkpoint no review peers or live runtime changes had been started. This foundation is not the complete first vertical slice and is not exposed as an installed native tool yet.

The public capture boundary has red/green evidence for working-tree, staged and committed targets, scoped region coverage, ordinary Git inspection, retained intent, integrity checks, non-UTF8 obligations, rename records, uninitialized submodules and external-link limitations. Additional fixtures cover root and merge commits, branch versus endpoint ranges, odd filenames/bytes/modes, concurrent mutation, configured Git drivers/filters/monitors, conflicts, ambiguous merge bases, unknown paths and missing references.

- `npx vitest run components/code-review/tests/capture.test.ts components/branch-search/tests/workspace.test.ts --maxWorkers=1`: 32 tests passed in two files. Log: `/tmp/review-capture-final.log`.
- `npm run typecheck`: Node and web passed. Log: `/tmp/review-capture-types.log`.
- Scoped Biome and `git diff --check` passed. Context lint passed for 334 sidecars.
- `npm pack --dry-run --json`: 2,743 files; all three new review source modules included. This is inventory evidence, not installed-package behavior.
- No full suite, paid model turn, runtime activation, native enqueue or UI claim.

### Checkout-scale capture

Captured the unchanged committed HEAD of this repository into private scratch directories, without sending source to a model:

| Acquisition | Files | Regions | Elapsed |
| --- | ---: | ---: | ---: |
| One process per blob | 4,930 | 12 | 353,715 ms |
| Git batch reads/imports, with verification | 4,930 | 12 | 21,376 ms |

The base tree, head tree, complete file-entry list and patch hash matched. These are single local measurements, not a controlled repeated benchmark or a review-effectiveness result. They justified removing a demonstrated subprocess bottleneck; they do not set a performance promise.

Logs: `/tmp/review-capture-benchmark.log`, `/tmp/review-capture-benchmark-batched.log`. Scratch artifacts: `/tmp/review-capture-benchmark.zhuwfU`, `/tmp/review-capture-batched.gVnPKK` (temporary, eligible for owner cleanup).

### A failure caught by stronger verification

`git write-tree` over an empty private index returned the known empty-tree ID without storing that object. An ordinary tree lookup passed, while `git fsck` reported the missing tree in a root-commit capture. A disposable direct Git reproducer established the behavior. `git mktree` with empty input stores the object; the root-commit fixture and capture-wide integrity check now pass.

## Durable admission and review contracts

The runtime now owns capture jobs independently of the requesting socket. It records verified target admission, interruption on restart, explicit same-artifact resume, cancellation, priority and reassignment. Unfinished review ownership participates in the shared departure and cross-organization move guards. At this admission checkpoint no peer execution loop or native tool was wired: admitted jobs remained queued pending the execution increment below.

The semantic contracts account for every changed region exactly once as primary ownership or a gap, retain distinct questions over identical files, require independent work for declared reliability/authority risk, preserve requested lenses, require question-level evidence accounting and retain every reported finding through validation/deduplication. These deterministic checks do not establish the quality of model planning or reported evidence.

`openPeerProgram` now accepts explicit runtime paths and preselected scope/command identities. An isolated test changes ambient state after choosing its runtime, then launches, runs and closes a fake peer against the selected runtime without starting a daemon in the other directory.

- Latest focused cohort: **128 tests in 13 files passed**, one worker, 78.88 seconds. `/tmp/review-admission-final-tests.log` covers admission/recovery, contract checks, peer cleanup, work recovery, attention, reporting moves, departure lifecycle and consumers of the historical-schema fixture.
- Node and web typechecks passed: `/tmp/review-admission-final-types.log`.
- Scoped Biome, whitespace checks and context lint passed; **336 context files**.
- Package dry run: **2,746 files**, including the new contract, operation and runtime-job modules. `/tmp/review-admission-pack.json`. Inventory only; no installed-package or UI build claim.
- Red logs include `/tmp/review-plan-red.log`, `/tmp/review-coverage-red.log`, `/tmp/review-peer-owner-red.log`, `/tmp/review-admission-red.log`, `/tmp/review-responsibility-red.log`, and `/tmp/review-move-red.log`. The first two queue responsibility checks reproduced an admitted owner departure and a reporting move that stranded a review before their shared guards were added.

### Existing cleanup defect encountered

Eight peer-cleanup tests failed on both the implementation tree and unchanged `651d2972` in a detached worktree. `discardProgramPeople` records explicit `discard` file-cleanup receipts, while `cleanMovedBundles` only selected `promote`. Both actions now use the existing cleanup owner; historical `finish` receipts still preserve their source files. The passing cohort retains those historical-source and temporary-process/task-cleanup checks. Baseline log: `/tmp/review-peer-baseline.log`. The scratch worktree and its node_modules symlink were removed normally.

The work-recovery fixture also used a different goal for an allegedly identical command retry. It now retries the original payload and separately asserts that a changed goal is refused. The new migration required the shared historical-schema fixture to remove the review table before declaring an older physical schema; the original lifecycle-row assertions remain intact.

No live daemon or app was restarted. All new socket/process checks used private state and fake peers. No paid reviewer, actual first-provider-input isolation, stale-attempt execution fence, native enqueue tool, `/reviews`, Workplace entry path or artifact-bound approval has been exercised yet.

## Durable review execution checkpoint

Migration35 adds attempt records. Jobs claim priority/FIFO work and use the existing program-peer client, launcher, correlated turns and guarded cleanup. A persisted program ID identifies its review attempt; no extra launcher, daemon, wire-level permission or tool sandbox was added. Ordinary Pi Exec launch behavior remains unchanged.

The worker now runs a code-informed planning request, validated semantic/risk obligations, separate first-inspection peers including whole-change integration, then finding and coverage challenge. The source directory and role policy are recorded; selected model/thinking are observed at turn start. Structured turn results and observed usage are retained before cleanup, including cancelled or malformed results. These data are model claims and observations, not independent proof of semantic correctness. Internal model overhead outside the correlated turn is not invented into its usage total.

- A public-command red step left the job queued instead of completed: `/tmp/review-worker-red.log`. The runtime now executes the pipeline and retains the captured value after the live checkout changes.
- Declared authority risk dispatches a distinct actual pass over the same regions. This uses a scripted planner; it does not establish that a real model reliably identifies that risk.
- Incomplete questions with zero findings remain incomplete. Resume reruns those questions while preserving completed planning. Unavailable role-model policy fails before a review turn is sent. A completed but malformed model response retains observed usage and fails validation rather than becoming a clean review.
- Cancellation retains the observed cancelled turn result and waits for scope/person cleanup. Restart interrupts an active attempt; explicit resume uses a new attempt/person/generation on the same artifact. A scripted obsolete receipt is sent through the replacement peer's real socket; a later fact on that socket proves processing order before assertions show the new attempt remains unfinished.
- Separate child processes run actual AgentSessions on a scripted SDK model with the organization/bridge/peer-turn installers. Captured provider messages include role system sections and ordinary read/bash results: relative source reads, Git comparison and search use the captured checkout. An author-self marker and another first report stay out of first inspections; validation receives the other report as a positive control. This is not every package extension, a live provider, or a model-quality experiment.
- Focused cohort: **108 tests in 10 files passed**, one worker, 69.07 seconds. `/tmp/review-worker-verified-tests.log` covers capture/contracts, queue execution, peer cleanup/history, ordinary onboarding, work recovery and inspection consumers.
- After strengthening the SDK test with ordinary shell/Git/search and a positive role-system-section check, **52 tests in six files passed**, one worker, 46.35 seconds. `/tmp/review-worker-sdk-final.log` also covers the remaining historical-schema fixture consumers. The two cohorts overlap; neither is a full-suite run.
- Final focused recheck after the prompt and provider-input assertions: **20 tests in two files passed**, plus Node/web types, scoped Biome across 13 source/test files and whitespace checks. Logs: `/tmp/review-worker-close-tests.log`, `/tmp/review-worker-close-types.log`. Context lint passed for **338 files**.
- Node/web types also passed in `/tmp/review-worker-types-final.log`. Package dry run: **2,748 files**, including `prompts.ts` and `review-attempt.ts`; `/tmp/review-worker-pack.json`. Inventory only, not an installed-package test.

### Ordinary onboarding baseline correction

The broad cohort found one failure in workplace.test.ts: it expected copied team backscroll. Unchanged ecae1117 reproduced it in a detached worktree (`/tmp/review-worker-onboarding-baseline.log`). The existing runtime already sends a channel/brief pointer. The test now positively checks that pointer and assigned goal, and excludes copied backscroll. Review-specific startup omits that automatic team notice while preserving ordinary tools and membership. The scratch worktree and its node_modules symlink were removed normally.

## Selected assessments and native entrypoint checkpoint

Migration36 records the selected attempt IDs explicitly. Read-only queue and detail projections share a consistent snapshot, retain attempt-scoped allegations and distinguish validator-challenged questions from completed coverage. A challenged inspection gets a new attempt on resume while the unaffected integration result can be retained. Review visibility follows review-owned organizational anchors, including a whole-root merge with no surviving work-task rows.

The SDK fixture calls the real extension's review_code, review_queue, read_review and manage_review tools against the isolated runtime. It admits work, reads unvalidated partial allegations, waits for guarded cancellation, recovers the original admission after the live checkout changes, then explicitly captures a different rerun linked to the first review. The extension is not yet registered in package.json; this is an entrypoint integration check, not a public activation claim.

- Initial reader/challenge/resume/scope failures: `/tmp/review-reader-red.log`, `/tmp/review-reader-coverage-red.log`, `/tmp/review-reader-resume-red.log`, `/tmp/review-reader-scope-red.log`.
- The 87-test reader cohort had one remaining failure: its multi-job fixture returned review_jobs[0] for every enqueue. The helper now follows the exact command's recorded review ID rather than inferring identity from table order. `/tmp/review-reader-final-tests.log` retains that failure.
- Final focused cohort: **88 tests in eight files passed**, one worker, 68.92 seconds. `/tmp/review-native-cohort.log` includes queue/native behavior, reporting moves and historical-schema consumers. The earlier **16-test single-file pass** overlaps this cohort: `/tmp/review-native-tests3.log`.
- Node and web types passed: `/tmp/review-native-types3.log`. Scoped Biome and whitespace checks passed; context lint passed for **340 files**.
- Package dry run: **2,752 files**; new result/read/tool modules and the entrypoint are present. `/tmp/review-native-pack.json`. This is inventory, not installed activation or model-quality evidence.

A stronger recovery case then reproduced loss of that coverage challenge after an intervening failed retry: `/tmp/review-challenge-recovery-red.log`. Current selections had been cleared, so a second resume reused the old challenged report. Migration37 now retains a reuse block on that exact attempt, atomically with the validator's output, before cleanup. The validator input names the attempts it challenges. Final recheck after this correction: **88 tests in eight files passed**, Node/web types and scoped Biome; `/tmp/review-checkpoint-tests2.log`, `/tmp/review-checkpoint-types2.log`. The earlier passing cohort did not cover this extra transition.

## Finding responses and assessment-bound approval checkpoint

Migration38 adds append-only review_decisions under the existing runtime command journal. Each decision uses its command ID. Finding responses retain original allegations and model validation, require counterevidence for rejection and scope/evidence for accepted risk, and distinguish unverified claims from a selected, completed, unchallenged verification question on another captured target. That verification retains the exact attempt, validator, digest, assessment revision and reported evidence. It records the responder's judgment, not automatic semantic proof.

Operator approval requires a settled assessment, verified retained source and an exact digest/revision match. Known limitations need explicit acknowledgment. A later fix does not repair the old snapshot, and a substantive owner response is not hidden by earlier model rejection. Later finding responses stale the old approval while preserving its record. The runtime rechecks authority and assessment identity after asynchronous verification, inside the command transaction.

- The real SDK fixture now calls resolve_finding and reads its decision history after guarded cancellation.
- A real-socket test covers unsupported rejection/risk decisions, stale response refusal, original allegation retention, claimed versus selected new-target fix verification, operator-only approval, required limit acknowledgment, later assessment invalidation and retained-source tampering.
- Focused cohort: **84 tests in seven files passed**, one worker, 74.37 seconds. `/tmp/review-decisions-final-tests.log` covers queue/native/decision behavior and historical-schema consumers. Node/web types and scoped Biome passed: `/tmp/review-decisions-final-types.log`, `/tmp/review-decisions-final-format.log`.
- TypeBox's mapped literal unions inferred never in actual typed callers despite runtime validation working. Explicit literal tuples passed typecheck and behavior checks; the durable context owns this constraint.
- Final post-authority-recheck: **17 queue/native tests passed**, one worker, 53.19 seconds; Node/web types, scoped Biome and whitespace checks passed. `/tmp/review-decisions-close-tests.log`, `/tmp/review-decisions-close-types.log`, `/tmp/review-decisions-close-format.log`.
- Context lint passed for **342 files**. Package dry run contains **2,754 files**, including both new decision modules: `/tmp/review-decisions-pack.json`. Inventory only.

No approval page, live operator sign-off, public extension activation, paid model-quality check or production migration has occurred.

## Remaining delivery

Coverage/extra-work decisions, freshness readers, the extra-work decision path, remaining native integration, single master-detail `/reviews` with visible list status and retirement of the old work panel, Workplace Code and artifact-bound sign-off, focused native/IPC/UI integration, applicable builds and real-host validation. No part of that remaining scope has been waived. No paid reviewer or live daemon/app activation has occurred.
