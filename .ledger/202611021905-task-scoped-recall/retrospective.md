Status: pending
Created: 2026-11-02
Updated: 2026-11-03

# Retrospective

## What Mattered

Pending completion of the undertaking.

## Learnings

Interim lessons; the actual-tool gate remains open.

- FTS5 BM25 uses corpus-wide statistics despite session/span eligibility filters. A small control changed eligible ordering by adding only another person's rows. Per-prefix index results are local-corpus evidence; the intended persistent corpus needs its own ranking check. The source hazard is recorded in `.context/components/session-state/src/transcript-index.ts.md`.
- Frozen source worktrees do not freeze the evaluation adapter. Concurrent reflection changed cleanup/tests; inspecting the diff and replaying complete responses established output equivalence for those runs, not automatic transfer of latency or coverage to the forthcoming actual tool. The adapter context records this boundary.
- To recover complete private JSON from a truncated tool display, use the retained private log, locate start and end markers by indexed positions, and verify the exact UTF-8 bytes/hash before saving with private permissions. Splitting on the start marker fails when the end marker contains that same string. This recovered the task gold and source judgments without putting their payloads in Git or mail. Read-only transcript parsing can also recover an untruncated tool result; a session loader may mutate original history.

## Improvements

Pending completion of the undertaking.
