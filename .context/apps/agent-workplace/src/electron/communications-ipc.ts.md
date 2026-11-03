## symbol:wireCommunications

Each adapter extracts its own operation fields. The renderer never supplies a runtime command.
Why: IPC is an allow-list of communication operations, not a general command socket.
Coupled: apps/agent-workplace/src/communications.ts, apps/agent-workplace/src/backend/communications.ts
Verify: apps/agent-workplace/tests/world-communications.test.ts
