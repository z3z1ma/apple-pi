Status: complete
Created: 2026-08-31
Updated: 2026-08-31

# Retrospective

## What Mattered

The highest-value changelog item replaces the normal path of a fragile local compatibility layer, but not its proven over-budget edge case. Comparing the upstream implementation, not only release prose, exposed the public fail-closed failure path and the cut-point gap where native compaction emits no event.

## Learnings

Pi's new pre-next-response compaction and UI prompt lifecycle events align with Apple Pi responsibilities. The notebook policy and xAI compaction remain distinct. Pi's summarization calls use the raw provider stream and bypass ordinary provider-request hooks, so the xAI hosted-tool hook needs no summarization exclusion. `session_compact_failed` has concrete continuation and notification consumers.

## Improvements

Test native compaction success, failure, cancellation, and the over-budget cut-point gap before narrowing the guard. Exercise the actual pair `triggerTurn: false` path after tool results, and test extension hooks against internal summarization traffic rather than only ordinary agent requests.
