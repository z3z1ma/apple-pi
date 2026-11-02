## symbol:useLiveReplies

Reply events remain local to this reader, but native watch ownership belongs to the top-level document's aggregate shared with retained World. Subscribe/unsubscribe using this hook instance's owner token; cleanup cannot replace the full native list with empty because another document may already display a different reader. Entry installs the aggregate before either application imports this hook.
Why: World and Workplace share one preload/backend subscription while React effect cleanup runs independently across their documents. Final-visible-ID tests in both switch directions are the behavioral proof; merely observing cleanup does not prove the visible reader still receives replies.
Coupled: apps/agent-workplace/web/reply-watches.ts, apps/agent-workplace/web/entry.ts, apps/agent-workplace/src/backend/conversations.ts
Verify: apps/agent-workplace/tests/reply-watches.test.ts, apps/agent-workplace/tests/world-navigation.test.ts
