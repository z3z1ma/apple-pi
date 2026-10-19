## symbol:openGate

`write` sends only when `token` is one `describe` issued for the same intent (compared as key-sorted JSON), unexpired (15 minutes), and unused; the token is spent before sending, so a second confirm of it sends nothing. Every sent write, failed or not, appends one JSON line to `agent-world-outside-writes.jsonl` (0600) and is announced to `onWrite` listeners (the chatbox).
Why: decision 13 requires confirmation showing exactly what goes where; the IPC channel takes whatever the renderer sends, so the backend, not the UI, must refuse an unconfirmed or altered write. A failed send is still recorded because it may have partly happened outside.
Coupled: apps/agent-world/src/backend/integrations/index.ts, apps/agent-world/src/electron/integrations-ipc.ts
Verify: apps/agent-world/tests/integrations/github.test.ts, apps/agent-world/tests/integrations/atlassian.test.ts, apps/agent-world/tests/integrations/slack.test.ts
