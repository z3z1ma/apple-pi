## file

Slack is called as the operator with the web client's session, per the credential decision recorded in `.ledger/202610171741-guildworld/tickets/27-slack-sign-in-and-the-town-square.md`: the `xoxc-` token goes in each form body as `token`, the `d` cookie as a `Cookie: d=<value>` header (sent as Electron stores it, already URL-encoded), against the workspace's own `<team url>api/` (from `auth.test`'s `url`), as the web client does.
Why: the web client's methods (`client.counts`) are served there; rusq/slackdump `internal/edge/edge.go` posts to `https://<workspace>.slack.com/api/` the same way. Standard methods work there too.
Verify: apps/agent-world/tests/integrations/slack.test.ts

Unread channels come from `client.counts` (undocumented; form `thread_counts_by_channel`, `org_wide_aware`, `include_file_channels`), whose `channels`, `mpims`, and `ims` rows carry `id`, `last_read`, `latest`, `mention_count`, and `has_unreads` but no unread count. The count is the number of `conversations.history` messages after `last_read` (`oldest`), up to 100 (`more` when `has_more`), for at most `COUNTED_MAX` channels per listing; names and kinds come from one cached `users.conversations` listing, people's names from `users.info`.
Why: korotovsky/slack-mcp-server (`pkg/handler/conversations.go`, `ConversationsUnreadsHandler`) does the same and notes that `conversations.info` returns no `unread_count` with browser tokens, although docs.slack.dev/reference/methods/conversations.info shows `last_read`, `unread_count`, `unread_count_display` for a DM. The cap keeps a listing to ~30 Tier 3 calls (docs: 50+ per minute); the square's visual bound is the UI's design choice.
Coupled: apps/agent-world/src/integrations.ts
Verify: apps/agent-world/tests/integrations/slack.test.ts

Sources (read 2026-10-19): docs.slack.dev/reference/methods/{conversations.info, users.conversations, conversations.replies, chat.postMessage}; github.com/rusq/slackdump `internal/edge/client.go` (`ClientCounts`), `doc/login-manual.md` (token from `localStorage.localConfig_v2`, the `d` cookie); github.com/korotovsky/slack-mcp-server `pkg/provider/edge/client.go` (`ChannelSnapshot` fields).

`invalid_auth`, `not_authed`, `token_revoked`, `token_expired`, and `account_inactive` become a refusal with `signIn: "slack"`.
Why: a web session ends when the operator signs out of Slack in a browser or the workspace rotates it; the UI then offers sign-in again instead of an error.
