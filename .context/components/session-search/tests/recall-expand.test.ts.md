## file

Keep PAIR_FULL_MARKER beyond the search snippet's two-line context window. The query matches line zero and the marker sits on line four, so the baseline excludes it while full expansion includes it. That contrast proves expansion recovered the body instead of merely repeating an already-visible snippet.

Coupled: components/session-search/src/search-entries.ts, components/session-search/src/tool.ts
Verify: components/session-search/tests/recall-expand.test.ts
