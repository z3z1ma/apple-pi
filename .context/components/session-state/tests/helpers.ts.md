## symbol:fakeBridge

Put organization fields such as `reportsTo` and `manages` in `hello.facts`, and check the stored reporting line when a fixture's tree matters.
Why: the fake accepts unchecked fields in `hello.session`. Putting `reportsTo` there silently created a second organization and duplicated a shared directory's backlog, rather than exercising the intended team.

Treat this fake as a socket peer, not a Pi session: receiving a runtime `close` command (including one issued by `retire`) does not make it shut down. To simulate a normal exit, send `link.send({ type: "shutdown", reason: "quit" })` before waiting for the incarnation to end. Read the local wrapper before using a `.stop()` method; this helper exposes only `socket` and `send`.
Why: other test fakes expose `.stop()`, and applying that interface here caused a test failure; waiting for automatic shutdown instead can leave the incarnation alive while its stand-in process still runs.
Coupled: components/session-state/src/protocol.ts, components/session-state/src/runtime.ts
Verify: components/session-state/tests/peers.test.ts, apps/agent-world/tests/workplace.test.ts

## symbol:sendCommand

This test helper returns the collected receipts array; check `receipts.at(-1)?.stage` for the final receipt it observed. The production helper of the same name returns one receipt. Confirm the import before asserting a command's result.
Why: treating an array as the production receipt reads an undefined stage, and this test helper can return before a terminal receipt if its wait ends; awaiting it alone does not prove the command applied.
Coupled: components/session-state/src/client.ts
Verify: components/session-state/tests/threads.test.ts
