## file

Test evidence-kind labels through displayed search results and retain quoted label-looking text through exact source recovery. Passage selection concerns the displayed answer; it leaves the source intact. Additional weak matches may remain as context while the answer-bearing passage stays visible.

Why: dropping quoted payload lines can conceal a false-label bug while corrupting recovery. A correct governing label and intact literal source test both sides without prescribing which unrelated lines a future window displays.

Coupled: components/session-search/src/search-entries.ts, components/session-search/src/drill-down.ts
Verify: components/session-search/tests/evidence-context.test.ts
