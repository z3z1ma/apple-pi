Status: pending
Created: 2026-11-02
Updated: 2026-11-03

# Retrospective

## What Mattered

- The index answered in milliseconds what whole-file scans needed hundreds of milliseconds for. Kofi's rule (filter ineligible entries inside the query, before the limit) kept the ranking honest.

## Learnings

Lessons from the index conversion and actual-tool evaluation.

- FTS5 BM25 uses corpus-wide statistics despite session/span eligibility filters. A small control changed eligible ordering by adding only another person's rows. Per-prefix index results are local-corpus evidence; the intended persistent corpus needs its own ranking check. The source hazard is recorded in `.context/components/session-state/src/transcript-index.ts.md`.
- Frozen source worktrees do not freeze the evaluation adapter. Concurrent reflection changed cleanup/tests; inspecting the diff and replaying complete responses established output equivalence for those runs, not automatic transfer of latency or coverage to the forthcoming actual tool. The adapter context records this boundary.
- To recover complete private JSON from a truncated tool display, use the retained private log, locate start and end markers by indexed positions, and verify the exact UTF-8 bytes/hash before saving with private permissions. Splitting on the start marker fails when the end marker contains that same string. This recovered the task gold and source judgments without putting their payloads in Git or mail. Read-only transcript parsing can also recover an untruncated tool result; a session loader may mutate original history.

- A read-only backup protects the live index but does not establish evaluation-corpus compatibility. The live v1 index lacked the candidate's ordinal/echo columns; opening that backup with the newer writer would drop its derived entries and clear file watermarks. Check schema compatibility and completed background population before replay. Use a compatible rebuilt snapshot or private reconstruction, and replace selected-person entries, watermarks and source paths only in scratch. A reset followed by indexing a few prefixes measures a different corpus, not the intended whole-index case.
- A replacement engine inherits the old tool's contracts. Read its docs and tests before choosing corpus and ranking: the first index included state-only `custom.data` and lost recall-echo demotion, two stated contracts that surfaced only when the old tests were migrated (fixed in ce4e8808).
- Before fixing a routing or refusal rule for a new scope, run the real question set through the existing router and count what it hits. search_session's regex heuristic routed 3 of 6 realistic task questions as regex, so "refuse tasks + regex" would have failed half of normal searches; task searches now always match words.
- Profile the actual tool path on the full multi-person corpus before handing a candidate to an evaluator. A single-transcript scratch bench showed 0-3 ms; the real tool took 201 ms p95 (no stopwords, session filter after MATCH, bodies read backwards from EOF). Those fixes brought it to 21-40 ms.
- Gate rounds (candidate freezes, contract records, per-decision mail) cost more than the operator wanted once he had given direction; he chose to land the second candidate on main ungated. Offer such a gate with its cost rather than assume it.

## Improvements

- The evaluation gate cost hours. Offer such gates as options with their cost.
