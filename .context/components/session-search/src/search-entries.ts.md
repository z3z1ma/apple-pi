## file

Keep the legacy heuristic-regex and BM25 ranking paths until a separate experiment clears its acceptance gate. The unified literal/explicit-regex pipeline was withdrawn after a frozen evaluation improved precision but lost historical evidence and sufficient displayed answers. Its candidate/page changes belong to that experiment too.

Why: deterministic lexical ranking is not proof of better historical evidence retrieval. A future ranking change must beat the frozen baseline and a held-out question set written before results are inspected.

Build evidence-section coordinates alongside searchable text from persisted content structure. Select a window's governing label from those coordinates, while retaining literal payload lines as data. Keep stable source identity through future ranking changes.

Why: payloads can quote structural-looking labels. Scanning flattened source lines promotes those quotations into false thinking/operation provenance. An attempted call or thought is not interchangeable with a returned result.

Coupled: components/session-search/src/tool.ts, components/session-search/src/format-recall.ts, components/session-search/src/load-messages.ts
Verify: components/session-search/tests/evidence-context.test.ts, components/session-search/tests/search-entries.test.ts
