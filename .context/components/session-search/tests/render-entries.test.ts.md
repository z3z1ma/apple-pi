## file

Compact user text and thinking must retain their beginning while omitting a distant tail marker; thinking must also retain the assistant's text. Full source rendering must recover the complete body.

Why: an empty user summary satisfies a length-only cap, and a thinking label with a short output also passes when the reasoning itself is discarded. Distinct visible prefix and tail evidence test actual clipping without fixing an incidental character limit.

Coupled: components/session-search/src/render-entries.ts
Verify: components/session-search/tests/render-entries.test.ts
