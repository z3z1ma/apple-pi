## file

The pair sees historical trajectory, not the current checkout. Active-context reseeding excludes advisory messages; historical context is prior context, not a fresh request to review old work.
Why: replaying the pair's own output or reviewing historical context as new activity would create feedback loops and duplicate findings.
Coupled: components/pair-programmer/src/extension.ts, components/pair-programmer/src/receipt-expansion.ts
Verify: components/pair-programmer/tests/pair.test.mjs, components/pair-programmer/tests/receipt-expansion.test.ts

## symbol:renderArgValue

Keep multiline string leaves verbatim at every container depth, without JSON escaping or added indentation.
Why: nested edit payloads and heredocs must retain the actual newlines/content the primary model used; escaped or re-indented text can look corrupted when it is not.
Verify: components/pair-programmer/tests/pair.test.mjs

## symbol:formatTurnDelta

A successful edit's canonical unified diff carries the historical change instead of a second unannotated oldText/newText dump. An error shows its diagnostic text and attempted arguments rather than trusting an accompanying diff.
Why: the current checkout may already contain later changes; only the successful point-in-time diff identifies which side persisted, while failed-edit diagnostics remain the evidence of failure.
Verify: components/pair-programmer/tests/pair.test.mjs

## symbol:buildReviewMessages

Each review message owns one text block with explicit section separators. Deltas remain separate user messages with visible headers.
Why: content-part joining and consecutive-user-message folding differ across providers; the shared-screen text must remain legible without depending on those joins.
Verify: components/pair-programmer/tests/pair.test.mjs

## symbol:formatAdvisoryContent

Terminal advice asks for a new self-contained final answer when it changes the primary's response.
Why: the user must be able to read the replacement answer alone rather than reconstruct an answer from a terse correction plus the earlier final response.
Verify: components/pair-programmer/tests/pair.test.mjs
