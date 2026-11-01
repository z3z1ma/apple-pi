## file

The one change-selection owner for review capture, freshness, code sign-off, explanations and Pi Exec evidence. An exact range never acquires merge-base semantics; only `branch` does. One `rev-parse` call pins every named endpoint after `--end-of-options`; this rev-parse echoes that marker as an output line, which the parser drops.

Mutable targets copy the index and run `git add -A` against the copy, as `git stash create` does, so Git's stat cache hashes only changed files. The copy must keep the index file's modification time: racy-git compares entries with the index file's own timestamp, and a fresh copy hid a same-second, same-size edit (reproduced in the tests). Writing an index re-hashes racily clean entries, which runs clean filters, so every command that writes the copied index carries the raw flags (empty-tree attribute source, no autocrlf, explicit filemode and symlinks); a plain `write-tree` ran a repository-configured filter in the capture test. `core.splitIndex=false` keeps a split index from writing shared index files into the author's repository.

`git add` runs with `core.bigFileThreshold=1`, so bulk check-in streams new blobs into one pack instead of one loose file each; file creation dominated here (5,000 untracked files: 3.5 s loose, 0.8 s packed, identical tree). New objects go to a private object directory with the repository's objects as an alternate; the author's index and object store stay unchanged. Close the change to remove an owned object directory.

The object reader uses `cat-file --batch -Z`: names may contain spaces, tabs and newlines, so replies other than `<oid> <type> <size>` (missing, submodule) carry no body.

Measured on this checkout: committed and staged targets open in about 30-60 ms; the working-tree target in about 175-330 ms depending on load, of which `git add -A` (the untracked scan, comparable to `git status` at about 90 ms) is most. Process spawns cost about 10 ms each here, so endpoints are batched into one rev-parse.

Coupled: components/code-review/src/capture.ts, components/browser-pages/src/git-diff.ts, components/pi-exec/src/evidence.ts, components/session-state/src/review-read.ts
Verify: components/shared/tests/git-change.test.ts, components/code-review/tests/capture.test.ts
