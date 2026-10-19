## symbol:openGate

`write` sends only when `token` is one `describe` issued for the same intent (compared as key-sorted JSON), unexpired (15 minutes), and unused; the token is spent before sending, so a second confirm of it sends nothing. Every sent write, failed or not, appends one JSON line to `agent-world-outside-writes.jsonl` (0600) and is announced to `onWrite` listeners (the chatbox).
Why: decision 13 requires confirmation showing exactly what goes where; the IPC channel takes whatever the renderer sends, so the backend, not the UI, must refuse an unconfirmed or altered write. A failed send is still recorded because it may have partly happened outside.
Coupled: apps/agent-world/src/backend/integrations/index.ts, apps/agent-world/src/electron/integrations-ipc.ts
Verify: apps/agent-world/tests/integrations/github.test.ts, apps/agent-world/tests/integrations/atlassian.test.ts, apps/agent-world/tests/integrations/slack.test.ts

`act` sends without a token, only for the kinds in `UNCONFIRMED` (today only `slack-mark-read`, Mark read in the square), and refuses every other kind; it still describes the write and records and announces it like a confirmed one.
Why: the operator decided (2026-10-19, `.ledger/202610191114-agent-world-alive/task.md`) that Slack is marked read only by an explicit button and that the button is the choice, so no confirmation; it changes only his own read state. Adding a kind to `UNCONFIRMED` skips decision 13's confirmation for it: only for writes nobody else sees.
Verify: apps/agent-world/tests/integrations/slack.test.ts
