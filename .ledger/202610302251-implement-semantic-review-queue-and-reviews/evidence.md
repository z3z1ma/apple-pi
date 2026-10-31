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

## Remaining delivery

Runtime-owned queue/attempt recovery and ordinary peer dispatch; semantic plans and independent risk/integration passes; result/disposition/freshness handling; native tools; single master-detail `/reviews` with visible list status and removal of the old work panel; Workplace Code and artifact-bound sign-off; focused integration, builds, package and isolated real-host validation. No part of that remaining scope has been waived.
