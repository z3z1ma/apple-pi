## file

The exported matcher tests retain legacy search semantics. Expected policy-source membership is independent of exact BM25 tie order. Public segment/provenance assertions live in source-recall.test.ts rather than reading private turnId metadata.

Why: relevance order is not chronology. Locking a score-specific order or internal grouping field obscures the actual promise that unrelated conversations remain separate in displayed results.

Coupled: components/session-search/src/search-entries.ts, components/session-search/tests/source-recall.test.ts
Verify: components/session-search/tests/search-entries.test.ts, components/session-search/tests/source-recall.test.ts
