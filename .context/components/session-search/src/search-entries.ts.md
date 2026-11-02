## file

Keep the legacy heuristic-regex and BM25 ranking paths until a separate experiment clears its acceptance gate. The unified literal/explicit-regex pipeline was withdrawn after a frozen evaluation improved precision but lost historical evidence and sufficient displayed answers. Its candidate/page changes belong to that experiment too.

Why: deterministic lexical ranking is not proof of better historical evidence retrieval. A future ranking change must beat the frozen baseline and a held-out question set written before results are inspected.

The legacy frequency counter inherits lastIndex from earlier tests of cached global regular expressions; matchAll can therefore skip first occurrences. Isolated candidate `98ec44fa` resets that cursor, but its frozen episode recovery fell from 7/19 to 6/19 despite a held-out rise from 6/20 to 7/20. Main retains the old scorer under the operator's quality gate. Treat correct frequency arithmetic and better historical retrieval as separate claims; a future correction needs an explicit decision, not an assumed gain from passing a unit probe.

Build evidence-section coordinates alongside searchable text from persisted content structure. Select a window's governing label from those coordinates, while retaining literal payload lines as data. Keep stable source identity through future ranking changes.

Why: payloads can quote structural-looking labels. Scanning flattened source lines promotes those quotations into false thinking/operation provenance. An attempted call or thought is not interchangeable with a returned result.

Coupled: components/session-search/src/tool.ts, components/session-search/src/format-recall.ts, components/session-search/src/load-messages.ts
Verify: components/session-search/tests/evidence-context.test.ts, components/session-search/tests/search-entries.test.ts
