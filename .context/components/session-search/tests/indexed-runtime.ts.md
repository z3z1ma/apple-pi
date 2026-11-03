## file

Keep existing evidence questions intact while giving their tool calls a scratch runtime and prefix-only index. Normalize synthetic entries to Pi's adjacent identity fields (`type`, `id`, `parentId`, `timestamp`) at the line's head: the backward reader deliberately identifies entries from the edges without parsing every payload. A merely valid JSON record with timestamp after its payload can index successfully but fail source recovery.

The native nested-call case keeps the SDK-owned file unchanged and seeds the index after the issuing assistant is persisted. This exercises exclusion of the actual native parent ID, rather than passing an issuer-negative check because that issuer was never indexed. Runtime fixture state is seeded before daemon startup and its environment is restored on cleanup.

Coupled: components/session-state/src/transcript-read.ts, components/session-search/tests/nested-recall.test.ts
Verify: components/session-search/tests/source-recall.test.ts, components/session-search/tests/evidence-context.test.ts, components/session-search/tests/recall-tool-scope.test.ts, components/session-search/tests/recall-expand.test.ts, components/session-search/tests/nested-recall.test.ts
