Status: in-progress
Created: 2026-11-02
Updated: 2026-11-03

# Task-scoped recall: message spans per task and a fast, salient session search

## Intent

Tie each task a person focuses to the span of their transcript written under it. Let `search_session` scope itself
to tasks, across everyone who worked them, and make recall fast and salient. See `proposal.md`, which records the
operator's decisions (2026-11-02).

## Done when

- Search no longer reads and parses a whole transcript per call: a runtime-owned full-text index answers in
  milliseconds.
- Focus spans are recorded for every focus change, and history is replayed.
- `search_session` searches natural-language queries through the index. Regex and exact addresses keep the current
  path.
- It offers a `tasks` scope, with the decided access: people on the task, managers above them, and the operator. It
  can look at written words only or at everything.
- The recall gate passes. Kofi Bhattacharya (research lead) owns it in `recall-gate.md`, with the harness in
  `engine-replay.mjs`. It requires:
  - no worse than the current engine on the frozen and held-out question sets;
  - warm p95 of 50 ms or less, and at least 5x faster;
  - a task-scoped question set, written by Ciaran;
  - correct permissions.
- Focused tests pass, and each step is committed and live.

## Current State

Code: the index is `components/session-state/src/transcript-index.ts`, written by the `transcript-indexer.ts` worker,
and stored in `~/.pi/agent/state/transcript-index.db`. Spans live in `focus-spans.ts` and the `focus_spans` table.
The runtime query is `search_transcripts` in `runtime.ts`. The tool is `components/session-search/src/tool.ts`.

- Index (`f026f6f1`): live since runtime pid 91969 (schema 51). It covers 116 of 123 known transcripts (776 MB) and
  answers live queries in about 18 ms. A test search took 0-3 ms, against about 450 ms just to load and parse a
  177 MB transcript today.
- Spans and the task-scoped runtime search (`911e2eec`): 800 spans were replayed from history, 7 are open, and
  triggers on `work_focus` record new ones. `search_transcripts` takes `tasks` and `caller`; `maySearchTask` enforces
  the decided access.
- Not yet: the `search_session` tool still uses the old engine and has no `tasks` parameter. It waits for Kofi's gate:
  the harness is frozen at `5bfd4f07` and Ciaran is writing the task set.
- Integration rule, raised by Kofi: drop ineligible entries inside the index query, before `limit`, never by
  filtering top hits that are already ranked. Ineligible means after the cutoff, off the active branch, or the
  searching call's own message. `searchIndex` already filters sessions and spans in SQL; branch and own-message
  exclusion need the same.
- Known limit, raised by Kofi: FTS5 bm25 statistics cover the whole index, so per-prefix comparisons measure local
  ranking. An end-to-end check on the live index is planned.

## Next steps

1. Wait for Kofi's report on candidate `f026f6f1`. If it fails, fix and resubmit a frozen revision.
2. Change `search_session`:
   - send natural-language queries to the index, applying the integration rule;
   - keep regex and exact addresses on the current engine;
   - add `tasks` and words-only or everything parameters;
   - let `entry:` addresses reach another person's entries.
3. Kofi's end-to-end check through the actual tool and live index, including the display check. Then land the change.

## Outcome

Pending.
