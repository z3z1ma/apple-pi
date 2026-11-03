# Proposal: task-scoped recall

The operator's idea: tie each task a person focuses to the span of messages it produced (entry n to entry m), let
`search_session` scope itself to a set of tasks, and make that search extremely fast and salient, since recall is one of
the larger levers of sessions-as-people.

## What exists (measured or read, 2026-11-02)

- **`search_session` reads and parses the caller's whole transcript on every call.** My 177 MB transcript costs about
  180 ms to read and 270 ms to parse (19,480 entries) before any searching. The cost grows with every entry. It is
  the same pattern that made DMs slow, and transcripts total 6.1 GB.
- **It searches only the caller's own session.** It has no task scope: `scope` is only `lineage` or `all`, and other
  values fall back to `lineage`. Shared threads have their own `search_messages`.
- **Ranking:** BM25-lite over rendered entries, with regex and exact-address modes. Kofi's labelled evaluation
  (6 historical questions, frozen and held-out sets) found:
  - Precision@5 is 10/30.
  - The relevant episode is found in 5/6 questions.
  - Episode recall is 7/19.
  - The displayed answer is sufficient in 2/6.
  - Two ranking changes that raised precision lowered episode recall and were rolled back. So ranking changes need
    that gate.
- **Focus history is not stored as intervals.** `work_focus` holds only the current focus. Transitions can be replayed
  from `work_changes` joined to each change's task-thread post (`inspection-context.ts` `focusChanges`). One path,
  closing an ephemeral task, is missing from that replay.
- **The runtime already indexes every transcript entry.**
  - The `messages` table holds one row per entry, with `at`, `role`, `tool`, `size` and a one-line `preview`.
  - The bridge sends these rows as entries are written.
  - The full text stays in Pi's JSONL.
  - Exact entry reads are now fast: a backward read from the file's end takes milliseconds.

## Proposal

1. **Spans: a record of who worked on what, written as it happens.** On every focus change, the runtime closes the
   person's open span and opens a new one.
   - Each span is `focus_spans(person, task_id, from_at, to_at, from_entry, to_entry)`: the n-to-m range, one row
     per interval.
   - History is backfilled from the retained work changes, marked as reconstructed, with the `close` gap fixed.
   - A span says "written while focused on this task", not "about this task". Readers present it that way.
2. **One full-text index in the runtime, kept current by the bridge.**
   - An SQLite FTS5 table holds each entry's searchable text: user and assistant text, tool calls and tool results.
     It lives beside the existing `messages` rows, fed by the same index messages.
   - A search becomes one indexed query with BM25 ranking, filtered by person, task spans and time. It takes
     milliseconds, whatever the transcript size.
   - Drill-down keeps reading the exact entry from the JSONL, which stays the source of truth.
   - Existing transcripts are backfilled once, in the background.
3. **`search_session` gains scopes.**
   - `tasks: [...]` searches the spans of those tasks, across every person who focused them, so a person picking up a
     task can recall what the last one did.
   - `people: [...]` searches named colleagues' sessions.
   - The default stays the caller's own session.
   - Results are grouped by task and person, with the task title, the span and the time. Each hit keeps its exact
     `entry:` address.
4. **Salience, measured before it lands.** Changes to ranking and display go through Kofi's frozen and held-out sets,
   plus a new task-scoped question set written before building. A change lands only if it beats the baseline on both.

## Decisions (operator, 2026-11-02)

- Visibility: people assigned to the task, plus managers above anyone who worked on it.
- Index: everything, with a search option to look only at written words (user, assistant, mail, summaries) or at everything (tool calls and results too). Both are useful in different ways.
- Order: the index first, then spans, then task scopes, then a measured salience pass.

## Decisions asked (kept for the record)

- **Who may search whose transcript:**
  - (a) anyone in the same organization;
  - (b) people assigned to the task, plus managers above anyone who worked on it;
  - (c) only the operator, through Workplace.

  A transcript holds private reasoning, tool output and file contents.
- **Index size:**
  - Tool results are most of the 6.1 GB.
  - Indexing everything gives the best recall but makes a large index, likely several GB.
  - Indexing only the words people and agents wrote, plus tool names and arguments, is far smaller.
  - The operator decides; no cap is chosen here.
- **Order:**
  - Spans, then the index, then scopes, then a salience pass, each landing behind its own check.
  - Alternatively, the index first, because it removes the per-call cost for everyone at once.
