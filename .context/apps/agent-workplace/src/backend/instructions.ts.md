## symbol:instructionCommand

The panel's only guard lives here, not just in the UI: an `abort` for a character whose run is not idle needs `confirmed: true`, or it is refused and nothing reaches the runtime; any kind other than `talk`, `steer`, `follow_up`, `abort`, `answer` and `withdraw` (of a follow-up the session still holds, by its command id) is refused.
A send that fails without a runtime `failed` receipt still reports `failed`. The runtime not answering, or going away, is a failure the runtime itself could not report.
Why: decision 13 gates interrupting a busy agent behind a confirmation, and the IPC channel takes whatever the renderer sends; the backend test proves a declined Stop sends no command.
Coupled: apps/agent-workplace/web/overlay/conversation/actions.tsx
Verify: apps/agent-workplace/tests/instruct.test.ts
