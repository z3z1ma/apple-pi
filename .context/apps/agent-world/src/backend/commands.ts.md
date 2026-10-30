## symbol:openCommands

`send` fails as "not answering" only when no receipt arrives within `ACCEPT_TIMEOUT_MS`; a retry's `delivered` snapshot also proves acceptance. It then waits for `applied` or `failed` while connected; connection loss after either receipt says the command may still have been applied. Same-ID concurrent callers share one unchanged request and its promise, with separate receipt listeners. A different request cannot replace a live waiter. Connection cleanup settles only waiters belonging to that socket.
Why: `abort` is applied only once the run has stopped and `start` only once the new session connects, which can take long; a timeout after acceptance would report a failure for a command that later succeeds.
Coupled: components/session-state/src/runtime.ts
Verify: apps/agent-world/tests/instruct.test.ts, apps/agent-world/tests/commands-client.test.ts
