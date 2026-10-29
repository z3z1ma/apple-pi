## file

These tests seed recorded reporting relationships in an isolated in-memory database, then exercise the channel reconciler and shared thread readers/writer. They prove channel membership, pull delivery, visible unread counts, retained messages and historical audience after structural changes. They do not exercise operator move authorization, socket receipts, startup ordering, or the Org UI.
Why: reconciliation consumes an already validated tree. Keeping move admission separate makes a failure identify channel behavior rather than unrelated process or command setup; the runtime integration tests own those boundaries.

Coupled: components/session-state/src/channels.ts, components/session-state/src/threads.ts
Verify: components/session-state/tests/channels.test.ts
