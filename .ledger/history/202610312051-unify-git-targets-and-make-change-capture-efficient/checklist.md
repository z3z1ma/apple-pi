# Delivery checklist

Approved scope: the operator requested every item from the Git interface audit and performance-first direction. This is implementation, not another approval gate.

Terms: an *explicit target* is the `review_code` target union (working-tree, staged, commit, range, branch). An *exact range* compares endpoint trees directly; a *branch* comparison uses their single merge base. *Capture* means retained Git objects plus a manifest; *materialize* means writing a checkout for reviewers.

Next step: move target resolution and object reading out of `components/code-review/src/capture.ts` only when the first non-review consumer (Explain or direct sign-off) adopts them, so the shared module has two real callers.

## Shared contract and consumers

- [x] One explicit target schema and resolver: working tree, staged, commit with parent selection, exact range, branch/merge-base. — `components/shared/src/git-change.ts` (GitTargetSchema, openGitChange); review_code, sign_off_code, explain_change and Pi Exec helpers import it.
- [x] Existing captures can be reused without recapture; Explain accepts a review capture and preserves its source identity. — `explain_change` and `sign_off_code` take `review` and read retained trees (`readCapturedChange`); tested in explain-change.test.ts.
- [x] Review capture uses the shared selection/acquisition implementation. — capture.ts snapshots through openGitChange into the capture object store.
- [x] Direct code sign-off supports every explicit target without enqueueing a model review. — `target` parameter; staged/commit test in code-review.test.ts; no queue call.
- [x] Explain supports every explicit target and cites the correct frozen before/after bytes. — Excerpts read both sides from the snapshot trees; commit/branch/review tests.
- [x] Pi Exec Git change/patch, neighborhood and test-selection helpers share target semantics, with actual guest stubs/guidance/examples updated. — `target` dict in evidence.ts, stubs, guest guidance, docs/exec.md, Ralph references and tests.
- [x] Document/task sign-off remains path-based; all actual Git-consuming input surfaces are accounted for. — Unchanged; inventory: review_code, read_review freshness, sign_off_code, explain_change, git_change family, Agent Workplace preview (uses captureReview).

## Efficiency and fidelity

- [x] Separate resolution, diff/content reads, retention and checkout; lightweight consumers create no reviewer worktree. — openGitChange resolves and snapshots; readChange/diff read; only captureReview packs and materializes.
- [x] Use native Git object IDs and batch reads/transfers; remove process-per-file diff acquisition. — One rev-parse, one cat-file --batch reader, one region diff, pack-objects closure, bulk check-in.
- [x] Acquire only needed mutable bytes/content; preserve index/worktree and observed concurrent-mutation refusal. — git add -A against an index copy hashes only stat-changed files; author index/objects unchanged (tested); concurrent-change refusal retained.
- [x] Retained captures remain independent of author repository and preserve byte/mode/link/pointer semantics. — Closure pack in the capture; existing capture tests (source loss, modes, links, pointers, binary) pass.
- [x] Materialize only for reviewer execution; preserve existing artifact/recovery/approval verification boundaries. — checkout-index only in captureReview; verifyArtifact keeps fsck and materialized checks.
- [x] Benchmark representative committed/mutable/staged targets, many files/large diffs/untracked files/linked worktrees, including equivalent native Git costs and repeat measurements. — benchmark.mjs and evidence.md (this checkout, 20k/2k modified, 5k untracked, linked worktree; staged/commit opens measured in probes).
- [x] Optimize measured bottlenecks, report time/process/space costs and qualified limits; avoid speculative caches. — Index refresh (checkout --index), loose-object writes (bulk check-in), delta search (--window=0), per-path diffs, freshness recapture; no caches added.

## Delivery evidence

- [x] Focused behavioral and cross-consumer target tests, including diverged ranges, root/merge commits, dirty index/worktree, filenames, binary/link/pointer handling, source loss and cancellation. — Shared, capture, browser-pages, evidence and Ralph tests; cancellation covered by existing capture/queue tests, not new ones.
- [x] Native/guest/browser/IPC consumer checks, bounded concurrency, types, scoped static checks/context lint. — See evidence.md.
- [x] Update runtime tool descriptions, skills/examples and product docs; retire contradictory old comparison semantics. — GIT_TARGET_HELP schema text, sign-off/explain guidelines, pi_exec guidance, docs/browser-pages.md, docs/code-review.md, docs/exec.md, explain-change skill, README.
- [x] Rebuild affected packaged browser/Electron outputs and verify source/package inclusion. — build:workplace rebuilt main.js; browser web unchanged (page-build test passes).
- [x] Commit verified increments and activate changed owners with fresh process/state observations; explain /reload where needed. — Commit 4a0d52ab. Runtime 27893 → 70285 (no active review, scope or control; 68 people, 2 settled reviews and 99 pending mail retained). App 70156 → 70795 by normal Quit, connected to 70285. Live freshness on the retained review: 284 ms (was 57.8 s). Pi sessions need /reload for the new tool schemas.
- [x] Final inventory maps every item to its verification or an explicit unresolved limitation; no missing item is silently waived. — Limits: capture preview still performs a full capture (about 3 s here) because admission binds its digest; first full verification re-hashes racy files once; materialization grows with tree size; no new cancellation test; full suite not run.

## Baseline

2026-11-01, one local observation on this checkout (4,995 committed files): native working diff 22.9ms; older browser working diff 183.2ms; full review commit capture 22.80s; full working-tree capture 31.84s (5,012 files, including task files). These operations are not equivalent: the full captures retain and materialize source. They establish the cost breakdown question, not a comparative speed claim. Logs: /tmp/git-unification-baseline.{log,json}; Git Trace2: /tmp/git-unification-baseline-trace.json. The allocating probe had an internal abort deadline and removed its private artifacts in finally.
