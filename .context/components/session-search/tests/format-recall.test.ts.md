## file

The adjacent-turn case must retain both surrounding turns in the displayed output and place the matching turn between them.

Why: a match and a segment separator alone still pass when the formatter drops all neighboring context. Assert the surrounding message bodies and their order rather than private grouping fields.

Coupled: components/session-search/src/format-recall.ts
Verify: components/session-search/tests/format-recall.test.ts
