# Retrospective

## What mattered

Measuring per Git command (Trace2) found the real costs: per-file Node copies and comparisons, an index without stat data (7.5 s refresh), loose-object writes on a machine where file creation is slow, and delta search during the closure pack. Each fix used Git's own mechanism: index copies with `git add -A`, `checkout-index --index`, bulk check-in, `pack-objects --window=0`.

## Learnings

- Copying a Git index must keep its modification time; racy-git compares entries with the index file's own timestamp. The fresh copy produced an intermittent "source changed" failure that a deterministic test now reproduces.
- Any command that writes an index can re-hash racily clean entries and run clean filters; raw flags belong on index writes, not only on `git add`.
- `core.bigFileThreshold=1` on `git add` makes bulk check-in write one pack instead of thousands of loose objects; on this machine that was the difference between 3.5 s and 0.8 s for 5,000 files.
- `git rev-parse --end-of-options` echoes the marker as an output line.
- Synthetic benchmark repositories hold loose objects unless packed; their packing cost overstates real repositories.
- Reusing a copied author index imported hidden state that overrides disk bytes: assume-unchanged and skip-worktree flags, cached converted blobs, info/configured/XDG attributes, repository config. A review confirmed 29 defects, mostly from this assumption, which an in-tree .gitattributes-only test never exercised. Test each state source separately; the fix runs Git in a private GIT_DIR.
- The first speedup claim compared unlike work: the old capture included fsck and byte comparison that the new one deferred to first verification. Capture plus first verification (about 7 s against 23-32 s) is the honest comparison.
