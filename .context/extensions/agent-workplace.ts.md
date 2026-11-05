## file

`/workplace` opens Agent Workplace and installs Electron on first use. Install steps appear on the status line.
Why: a failed install leaves nothing behind, so running the command again retries from the start instead of resuming a partial install.

It also installs the hooks that send agents' Slack MCP messages as the operator when he turned that on in Workplace Settings; they do nothing while it is off.
Coupled: apps/agent-workplace/src/slack-sending.ts
