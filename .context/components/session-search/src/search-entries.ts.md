## file

Keep the legacy heuristic-regex and BM25 ranking paths until a separate experiment clears its acceptance gate. The unified literal/explicit-regex pipeline was withdrawn after a frozen evaluation improved precision but lost historical evidence and sufficient displayed answers. Its candidate/page changes belong to that experiment too.

Why: deterministic lexical ranking is not proof of better historical evidence retrieval. A future ranking change must beat the frozen baseline and a held-out question set written before results are inspected.

Retain evidence-section labels in displayed windows and stable source identity through future ranking changes.

Why: an attempted call or thought is not interchangeable with a returned result, and a ranked neighbor need not share chronology or ancestry.

Coupled: components/session-search/src/tool.ts, components/session-search/src/format-recall.ts, components/session-search/src/load-messages.ts
Verify: components/session-search/tests/evidence-context.test.ts, components/session-search/tests/search-entries.test.ts
