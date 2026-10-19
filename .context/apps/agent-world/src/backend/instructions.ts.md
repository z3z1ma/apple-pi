## symbol:instructionCommand

The panel's only guard lives here, not just in the UI: an `abort` for a character whose run is not idle needs `confirmed: true`, or it is refused and nothing reaches the runtime; any kind other than `talk`, `steer`, `follow_up`, `abort`, and `answer` is refused.
Why: decision 13 gates interrupting a busy agent behind a confirmation, and the IPC channel takes whatever the renderer sends; the backend test proves a declined Stop sends no command.
Coupled: apps/agent-world/web/overlay/conversation/actions.tsx
Verify: apps/agent-world/tests/instruct.test.ts
