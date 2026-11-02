## file

Positive discovery assertions identify returned source addresses or evidence, rather than only repeating the requested term. Exact recovery checks follow continuation addresses and inspect complete write/edit payloads.

Why: the public tool echoes queries even when requested evidence is absent. A query-echo assertion can pass after filtering, ranking or slicing removes the actual result. Tests for the withdrawn query/ranking/pagination experiment return with that experiment, rather than asserting an abandoned contract here.

Coupled: components/session-search/src/tool.ts, components/session-search/src/drill-down.ts
Verify: components/session-search/tests/source-recall.test.ts
