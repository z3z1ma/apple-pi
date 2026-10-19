## symbol:blocksOf

A tool result is drawn inside its call's folded line, found by `callId` across every loaded page; a result whose call is on a page not loaded yet stands alone as a folded "result" line until that page arrives.
Why: pages split turns anywhere, and the newest page is often a run of results whose calls are older.
Verify: apps/agent-world/tests/world-conversation.test.ts
