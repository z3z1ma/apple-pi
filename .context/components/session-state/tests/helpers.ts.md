## file

`tempStateDir` isolates tmux: an empty socket directory and no inherited pane, so the runtime never reads the operator's servers. A test that needs tmux starts scratch servers and points `TMUX_TMPDIR` at its own directory.
Why: an inherited pane or the operator's socket directory would attach the test runtime to his live sessions.

## symbol:fakeBridge

Use `hello.process` overrides for an explicit launch token when a control claims the same launch across hellos. The default remains a raw legacy-shaped socket hello; it does not infer a token from PID/time.

Put organization fields such as `reportsTo` and `manages` in `hello.facts`, and check the stored reporting line when a fixture's tree matters.
Why: the fake accepts unchecked fields in `hello.session`. Putting `reportsTo` there silently created a second organization and duplicated a shared directory's backlog, rather than exercising the intended team.

Treat this fake as a socket peer, not a Pi session: receiving a runtime `close` command (including one issued by `retire`) does not make it shut down. To simulate a normal exit, send `link.send({ type: "shutdown", reason: "quit" })` before waiting for the incarnation to end. Read the local wrapper before using a `.stop()` method; this helper exposes only `socket` and `send`.
Why: other test fakes expose `.stop()`, and applying that interface here caused a test failure; waiting for automatic shutdown instead can leave the incarnation alive while its stand-in process still runs.
Coupled: components/session-state/src/protocol.ts, components/session-state/src/runtime.ts
Verify: components/session-state/tests/peers.test.ts, apps/agent-workplace/tests/workplace.test.ts

## symbol:close

`dispose` alone emits no `session_shutdown`, so the bridge would stay connected and start a new runtime once the test stops the old one. `close` emits shutdown first.
Why: a disposed session's link stays connected; when the test stops the runtime, the link starts a new one into a directory the test is deleting.

## symbol:stopRuntime

This stops the runtime and deletes the whole temporary state directory, so it cannot restart a runtime mid-test. To restart with state kept, send SIGTERM to `runtimePid(state.pidPath)`, wait until the socket file is gone, then call `startRuntime(state.socketPath)`.
Why: after `stopRuntime`, opening the database fails with "unable to open database file".
Verify: components/session-state/tests/stuck-work.test.ts, components/session-state/tests/channel-membership.test.ts

## symbol:sendCommand

This test helper returns the collected receipts array; check `receipts.at(-1)?.stage` for the final receipt it observed. The production helper of the same name returns one receipt. Confirm the import before asserting a command's result.
Why: treating an array as the production receipt reads an undefined stage, and this test helper can return before a terminal receipt if its wait ends; awaiting it alone does not prove the command applied.
Coupled: components/session-state/src/client.ts
Verify: components/session-state/tests/threads.test.ts
