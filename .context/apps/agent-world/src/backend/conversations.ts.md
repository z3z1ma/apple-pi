## symbol:openConversations

Keeps its own runtime connection, separate from `openWorldBackend`'s, and never starts a runtime; a closed connection fails every waiting request with "The session runtime is not answering." and the next request reconnects.
Why: the world backend's connection is its liveness signal and carries only `set_preference`; paging a long transcript can take seconds and must not delay it. Agent World only reads and asks, so starting a runtime is the bridges' job.
Coupled: components/session-state/src/runtime.ts, apps/agent-world/src/electron/main.ts
Verify: apps/agent-world/tests/conversation.test.ts

Replies are matched by `requestId` (pages) or `commandId` (receipts); `markSeen` settles on `applied` or `failed` and ignores `accepted`.
Why: the runtime answers both on the same connection, one line each, in any order.
Verify: apps/agent-world/tests/conversation.test.ts

Live replies use a third connection that only subscribes (`watch` replaces the list; an empty list ends it) and resubscribes a second after it closes while anything is watched; each `reply_end` naming an entry is read back with `read_entry` on the main connection before its `end` event goes out.
Why: the runtime replaces a connection's subscription on every `subscribe`, and streamed text is lost with its connection, so the stream must not share the reader's connection or depend on a page read finishing; the panel needs the stored entry itself to swap it in without a jump.
Coupled: components/session-state/src/runtime.ts, apps/agent-world/web/overlay/conversation/live-reply.ts
Verify: apps/agent-world/tests/instruct.test.ts
