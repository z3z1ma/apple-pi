## file

One top-level renderer document owns this aggregate for the native watchReplies API, which replaces its entire watch list. The trusted World frame receives the same parent function before its UI loads. Every mounted reader registers a stable owner object and removes only that owner during cleanup. Distinct readers of one character deduplicate at the native boundary, not in ownership bookkeeping.

The queued native invocation derives its list from current owners, so cleanup and setup in either document can interleave without replaying an obsolete captured set. The helper returns the native promise and preserves rejection; it does not introduce a success-shaped fallback. Backend subscription/reconnect authority stays unchanged.
Why: independent parent/child effects previously sent [character] and [] directly; late hidden-World cleanup erased the newly visible parent reader's subscription. A per-document module registry alone would reproduce the same bug because the two documents load separate modules.
Coupled: apps/agent-world/web/entry.ts, apps/agent-world/web/overlay/conversation/live-reply.ts, apps/agent-world/src/backend/conversations.ts
Verify: apps/agent-world/tests/reply-watches.test.ts, apps/agent-world/tests/world-navigation.test.ts
