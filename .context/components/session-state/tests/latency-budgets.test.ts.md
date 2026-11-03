## file

Populate every transcript's FTS rows before starting the daemon, including the large paging fixture, and assert the resulting corpus count. Runtime startup queues every known transcript for backfill; leaving only the large file unindexed made warm timing depend on an unplanned concurrent writer. The fixed corpus is 129 sessions and 163,840 entries, with all file watermarks complete.

Measure the actual socket requests and assert nonempty, correctly scoped results. An error reply, empty index or incomplete page must fail rather than become a very fast successful sample. Fixture creation and indexing stay outside the latency window; the page budget covers the newest fifty bodies, not old pages that scan backwards through half the file.

The p95 convention and deliberate ceiling changes are recorded in the governing build-budgets ledger record. Changes to fixture scale or timing boundaries require a fresh stated baseline, rather than transferring the old number silently.

Coupled: components/session-state/src/runtime.ts, components/session-state/src/transcript-index.hot.ts, tests/helpers/build-budgets.ts
Verify: components/session-state/tests/latency-budgets.test.ts
