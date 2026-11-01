# Evidence

## Measurements

Local observations on the operator's Mac (Apple Git 2.54), medians of three runs from [benchmark.mjs](benchmark.mjs), milliseconds. Synthetic repositories are freshly committed, so their objects are mostly loose; real repositories are mostly packed. Not latency guarantees.

| Case | git status | git diff HEAD | open working tree | page diff | open commit | review capture | verify (median) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| this checkout (~5k files, 198 MiB) | 133 | 30 | 307 | 287 | 36 | 2,699 | 856 |
| 20k files, 2k modified | 227 | 403 | 561 | 661 | 26 | 6,086 | 181 |
| 5k untracked files | 26 | 15 | 985 | 1,018 | 25 | 3,329 | 141 |
| linked worktree of the 20k repo | 50 | 27 | 110 | 126 | 25 | 5,121 | 167 |

Baseline before this task, same checkout: older browser working diff 183 ms (it read untracked files separately and the live checkout for highlighting); review commit capture 22.8 s; working-tree capture 31.8 s; live freshness about 58 s (two full captures).

What the numbers say:

- A working-tree snapshot costs about `git status` plus reading changed and untracked file contents; committed targets cost one `rev-parse`.
- Bulk check-in mattered most for many new files. On this machine creating files is slow (copying 5,000 small files took 1.65 s): 5,000 loose blobs took 3.5 s to write, the same blobs as one pack 0.8 s, with the same tree ID.
- `pack-objects --window=0` halved closure transfer for this checkout (1.02 s to 0.46 s at the command line) with the same pack size, because stored deltas are reused.
- Review capture now grows mainly with materializing reviewers' checkout (`checkout-index`: 4.4 s for 20,000 files) and, for loose-object repositories, packing. Lightweight consumers never materialize.
- The first full verification after a capture re-hashes racily clean files once (4-7 s for this checkout); later ones take about 0.8 s, mostly `fsck`.

Trace2 per-command breakdowns: /tmp/git-unification-baseline-trace.json (before); single-capture profiles recorded during the session (update-index refresh 7.5 s before `checkout-index --index`; pack-objects 5.2 s on a loose-object repository).

## Reproduced failures and their tests

- Racy-git: copying the index gave it a fresh timestamp, so a same-second, same-size edit was invisible to the second snapshot. Preserving the timestamp fixed it; `components/shared/tests/git-change.test.ts` fails with the timestamp copy removed (red run recorded).
- Clean filters: `write-tree` on the copied index ran a repository-configured filter (Trace2 showed the child) because writing an index re-hashes racily clean entries. Raw flags on every index-writing command fixed it; the existing capture test catches it.
- `cat-file --batch -Z` replies for missing names with spaces and for submodule entries carry no body; the reader treats any non `<oid> <type> <size>` header as absent.
- Freshness compares Git identities, intent and configuration; the existing test caught that configuration had been part of the requested-target identity.

## Checks run

Focused, one worker:

- Final cohort after every change: code-review, shared git-change, Pi Exec evidence and guidance, Ralph programs, browser-pages and session-state review-queue: 21 files, 207 tests passed. An earlier run caught the freshness expectation fixed above.
- Agent World reviews backend, world build consistency, browser page builds: 7 passed after `npm run build:world`.
- `npm run test:loader`, `npm run typecheck`, scoped Biome on changed files, `context_lint` (351 files).
- `apps/agent-world/scripts/workplace-electron-check.mjs`: actual preload/IPC/runtime preview, admission, queue, captured source and freshness passed; no reviewers started.

Not run: the full test suite (operator policy), a paid review, a live operator sign-off.
