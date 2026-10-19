## symbol:openCommands

`send` fails as "not answering" only when no `accepted` arrives within `ACCEPT_TIMEOUT_MS`; once accepted it waits for `applied` or `failed` as long as the connection stays open, and a connection lost after acceptance says the command may still have been applied.
Why: `abort` is applied only once the run has stopped and `start` only once the new session connects, which can take long; a timeout after acceptance would report a failure for a command that later succeeds.
Coupled: components/session-state/src/runtime.ts
Verify: apps/agent-world/tests/instruct.test.ts
