# Implementation evidence

## Capture foundation (in progress)

Implemented personally in `components/code-review/`; no reviewer or live runtime changes have been started. This foundation is not the complete first vertical slice and is not exposed as an installed native tool yet.

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

The runtime now owns capture jobs independently of the requesting socket. It records verified target admission, interruption on restart, explicit same-artifact resume, cancellation, priority and reassignment. Unfinished review ownership participates in the shared departure and cross-organization move guards. No peer execution loop or native tool is wired yet: an admitted job remains queued until the next implementation increment supplies that owner.

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

## Remaining delivery

Runtime-owned attempt execution/recovery and ordinary peer dispatch; semantic plans and independent risk/integration passes; result/disposition/freshness handling; native tools; single master-detail `/reviews` with visible list status and removal of the old work panel; Workplace Code and artifact-bound sign-off; focused integration, builds, package and isolated real-host validation. No part of that remaining scope has been waived.
