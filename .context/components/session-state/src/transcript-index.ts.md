## file

The index is derived, not authoritative: Pi's JSONL stays the source of truth and readers drill into it by entry id. It lives in its own database (`transcript-index.db`) so gigabytes of text never enter the runtime's database or its backups. Only the worker thread (`transcript-indexer.ts`) writes it; the runtime searches through a separate read-only connection, so tokenizing a backfill never holds the runtime's thread.

A session's progress is a byte offset past its last complete line, plus `files.messages`, the count of `message` records read so far. A file that changed path or inode, or shrank, is indexed from the start again rather than appended to. `ordinal` is a message entry's `#N`: every record with `type: "message"` and a `message` takes the next number before any searchability skip, exactly as `load-messages.ts` counts them. The index is derived data, so a schema change drops and rebuilds it.
Why: search_session's addresses (`#N`, `#N:path`) outlive the session; a different count would point existing citations at different evidence.
Coupled: components/session-search/src/load-messages.ts

Eligibility (sessions, task spans, `exclude`) lives in one WHERE clause shared by `searchIndex` and `countIndex`, so it applies before `limit`/`offset` and the total matches the pages. Exclusion lists only what to drop (off-lineage entries, the issuing call): an allow-list of a long transcript's branch would grow past SQLite's parameter limit.
Why: filtering already-ranked top hits hides eligible evidence that ranked just below the cut (Kofi's recall gate rule).

The corpus is what search_session shows, no more: messages, `custom_message`, summaries, and only the notebook `custom` records (`NOTEBOOK_RECORDS`, the same list as `notebookText` in load-messages.ts). Earlier `search_session`/`revisit_note` results carry `echo = 1` and are ordered before bm25 (`order by echo, score`), inside the query, so they always rank behind original evidence.
Why: docs/context.md keeps state-only extension records out of recall, and an echoed result repeating a word outscored the original under plain bm25; the existing source-recall and evidence-context tests hold both rules. A new notebook record type must be added to both lists.
Coupled: components/session-search/src/load-messages.ts, components/session-search/src/search-entries.ts

Ranking is gated: replacing `search_session`'s engine with this index must pass Kofi's frozen and held-out recall sets (non-inferiority for the infrastructure swap, beating both for later salience changes). Query words are OR'ed, matching the current engine's semantics, and quoted so punctuation stays literal; regex queries are not translated.
Why: two earlier ranking changes raised precision but lost episode recall and were rolled back (`.ledger/history/202611020022-long-lived-agent-recall-and-retention/`).
Coupled: components/session-state/src/transcript-indexer.ts, components/session-state/src/runtime.ts, components/session-state/src/paths.ts
Verify: components/session-state/tests/transcript-index.test.ts
