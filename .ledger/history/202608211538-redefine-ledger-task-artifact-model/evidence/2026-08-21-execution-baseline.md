Status: recorded
Created: 2026-08-21
Updated: 2026-08-21

# Execution baseline

## Purpose

Capture the pre-implementation worktree and content-bearing `.ledger/history` state required to preserve unrelated work and prove AC-005.

## Source State

- Git revision: `8706e4d302abdbf0f6dd334f4c73c51827902ada`.
- Branch: `main`, tracking `origin/main`.
- The worktree already contained this task bundle, a modified `.ledger/INDEX.md`, and unrelated untracked records under `.ledger/202608211615-implement-first-class-llm-wiki/`.
- `.ledger/history` had no tracked or untracked status entries.

## Procedure

```bash
BASE=.ledger/202608211538-redefine-ledger-task-artifact-model/evidence/.storage/execution-baseline
mkdir -p "$BASE"
git status --short --branch > "$BASE/git-status.txt"
git status --short -- .ledger/history > "$BASE/history-status.txt"
git diff --binary HEAD -- .ledger/history > "$BASE/history-working-tree.patch"
find .ledger/history -type f -exec shasum -a 256 {} + | LC_ALL=C sort > "$BASE/history.sha256"
git rev-parse HEAD
```

## Observations

- `git-status.txt` contains 16 lines and records the unrelated first-class LLM wiki task without modifying it.
- `history-status.txt` is empty.
- `history-working-tree.patch` is empty (0 bytes).
- `history.sha256` records hashes for 102 files.
- Captured artifacts are under `evidence/.storage/execution-baseline/`.

## Limits

This baseline proves only the state at execution start. Final preservation requires recreating the history patch and hash manifest and comparing them byte-for-byte. Task-local evidence files created after the status snapshot are expected additions and do not alter the archived-history comparison.
