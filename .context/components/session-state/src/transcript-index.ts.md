## file

The index is derived, not authoritative: Pi's JSONL stays the source of truth and readers drill into it by entry id. It lives in its own database (`transcript-index.db`) so gigabytes of text never enter the runtime's database or its backups. Only the worker thread (`transcript-indexer.ts`) writes it; the runtime searches through a separate read-only connection, so tokenizing a backfill never holds the runtime's thread.

A session's progress is a byte offset past its last complete line. A file that changed path or inode, or shrank, is indexed from the start again rather than appended to.

Ranking is gated: replacing `search_session`'s engine with this index must pass Kofi's frozen and held-out recall sets (non-inferiority for the infrastructure swap, beating both for later salience changes). Query words are OR'ed, matching the current engine's semantics, and quoted so punctuation stays literal; regex queries are not translated.
Why: two earlier ranking changes raised precision but lost episode recall and were rolled back (`.ledger/history/202611020022-long-lived-agent-recall-and-retention/`).
Coupled: components/session-state/src/transcript-indexer.ts, components/session-state/src/runtime.ts, components/session-state/src/paths.ts
Verify: components/session-state/tests/transcript-index.test.ts
