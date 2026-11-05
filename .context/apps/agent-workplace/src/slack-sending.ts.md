## file

When the operator turns on Send agents' Slack messages as me (`sendAsMe` on the stored Slack session), a call to any MCP server's `slack_send_message` or `slack_schedule_message` is sent through his own Slack session instead, with the message as `markdown_text`, and recorded in the outside-writes record with the sending session's name. Off, signed out, a sign-in refusal from Slack, or a `draft_id` (the MCP tool deletes the draft; we cannot) leaves the call to the MCP tool.
Why: Slack's MCP server adds a context block `*Sent using* <@Claude app>` to every message it posts; a `chat.postMessage` with the web session carries none. Seen on 2026-11-05 by posting both to the operator's own DM and reading them back. `markdown_text` rendered bold, italic, strike, code, links, lists, quotes, fenced code with its language and a Markdown table as a native table, so no conversion is needed. The operator decided agents send without a forced confirmation; he tells an agent to check with him when he wants one, and reviews what was sent in Settings.

Pi runs a blocked `tool_call` as an immediate error result and skips `afterToolCall`/`tool_result`, so the hook sends, blocks with the success text, and the `message_end` handler replaces that tool-result message with the same text and `isError: false`. A call from a codemode script or a forked continuation has no `message_end` for its result, so there the send still happens but the caller sees the success text as an error.
Why: no Pi hook can substitute a tool's result before execution, and re-registering the MCP tool's name is undone each time the MCP extension reconnects.

A refusal other than sign-in is returned as an error and not retried through MCP.
Why: the message may have partly reached Slack, and the MCP path would post it again with the attribution.

Coupled: apps/agent-workplace/src/backend/integrations/slack.ts, apps/agent-workplace/src/backend/integrations/credentials.ts, apps/agent-workplace/src/backend/integrations/gate.ts, apps/agent-workplace/web/workplace-connections.tsx, extensions/agent-workplace.ts
Verify: apps/agent-workplace/tests/slack-sending.test.ts
