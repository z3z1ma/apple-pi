## file

Resolve exact entry/call/file addresses against the selected scope before excluding the issuing assistant entry from discovery. History, file and touched discovery share that selection. Native executeTool child IDs extend their persisted parent ID as caller/n, including recursively nested calls.

Why: issuer exclusion prevents the current query from becoming its own evidence, but historical exact addresses must remain usable.

Legacy query detection and discovery limits remain after a newer ranking/query pipeline was withdrawn for historical-evidence regressions. Treat displayed discovery as a bounded selection; recover complete evidence through stable source addresses.

Why: source availability, top-result relevance and displayed-answer sufficiency are different outcomes. Correct extraction alone does not establish complete discovery or better recall.

Coupled: components/session-search/src/search-entries.ts, components/session-search/src/drill-down.ts
Verify: components/session-search/tests/source-recall.test.ts, components/session-search/tests/recall-expand.test.ts, components/session-search/tests/nested-recall.test.ts
