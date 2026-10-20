## file

Slack is called as the operator with the web client's session, per the credential decision recorded in `.ledger/202610171741-guildworld/tickets/27-slack-sign-in-and-the-town-square.md`: the `xoxc-` token goes in each form body as `token`, the `d` cookie as a `Cookie: d=<value>` header (sent as Electron stores it, already URL-encoded), against the workspace's own `<team url>api/` (from `auth.test`'s `url`), as the web client does.
Why: the web client's methods (`client.counts`) are served there; rusq/slackdump `internal/edge/edge.go` posts to `https://<workspace>.slack.com/api/` the same way. Standard methods work there too.
Verify: apps/agent-world/tests/integrations/slack.test.ts

Unread channels come from `client.counts` (undocumented; form `thread_counts_by_channel`, `org_wide_aware`, `include_file_channels`), whose `channels`, `mpims`, and `ims` rows carry `id`, `last_read`, `latest`, `mention_count`, and `has_unreads` but no unread count. The count is the number of `conversations.history` messages after `last_read` (`oldest`), up to 100 (`more` when `has_more`), for at most `COUNTED_MAX` channels per listing; names and kinds come from one cached `users.conversations` listing, people's names from `users.info`.
Why: korotovsky/slack-mcp-server (`pkg/handler/conversations.go`, `ConversationsUnreadsHandler`) does the same and notes that `conversations.info` returns no `unread_count` with browser tokens, although docs.slack.dev/reference/methods/conversations.info shows `last_read`, `unread_count`, `unread_count_display` for a DM. The cap keeps a listing to ~30 Tier 3 calls (docs: 50+ per minute); the square's visual bound is the UI's design choice.
Coupled: apps/agent-world/src/integrations.ts
Verify: apps/agent-world/tests/integrations/slack.test.ts

Sources (read 2026-10-19): docs.slack.dev/reference/methods/{conversations.info, users.conversations, conversations.replies, chat.postMessage}; github.com/rusq/slackdump `internal/edge/client.go` (`ClientCounts`), `doc/login-manual.md` (token from `localStorage.localConfig_v2`, the `d` cookie); github.com/korotovsky/slack-mcp-server `pkg/provider/edge/client.go` (`ChannelSnapshot` fields).

The crier's search is the documented `search.messages` (form `query`, `count` 20, `page`, `highlight=true`, `sort=score`, `sort_dir=desc`: Slack's own default order, "most relevant"), plus channel-name matches from `conversations.list` and `users.conversations` on page 1 only. A match's `channel.name` is the other person's user id when `type` is `im`; a reply's thread comes from its permalink's `thread_ts` query parameter (`search.messages` has no documented `thread_ts`); the excerpt is built from Slack's highlight markers U+E000 and U+E001, which pass through `plain`. Paging is `page` and `messages.paging.pages`; Slack serves at most 100 per page and page 100.
Why: the web client itself searches with the undocumented `search.modules` (`module` `messages` or `channels`, cursor paging, `search_context`, `client_req_id`, and other web-client fields; rusq/slackdump `internal/edge/search.go` posts `search.modules.channels` that way), whose form and answer are not documented and change with the client. `search.messages` accepts the same `xoxc` session as a user token: korotovsky/slack-mcp-server (`pkg/handler/conversations.go`, `ConversationsSearchHandler`, `convertMessagesFromSearch`, which reads the thread from the permalink) uses it with browser tokens, and only bot tokens are refused (its README). docs.slack.dev/reference/methods/search.messages (read 2026-10-19) documents `count`, `page`, `highlight`, `sort`, the `im` channel name, and the markers; it calls the method legacy and recommends `assistant.search.context`, which needs an app's action token, not a web session.
Coupled: apps/agent-world/src/integrations.ts, apps/agent-world/web/overlay/places/square.tsx
Verify: apps/agent-world/tests/integrations/slack.test.ts

Every conversation (the crier's and the Slack tab's All channels) is `users.conversations` (all four types, every cursor page) read afresh when asked, with one `client.counts` for `has_unreads` and `mention_count`; people are named with `users.info`, at most `NAMING_AT_ONCE` at a time, cached for the session; a group's `mpdm-a--b--me-1` name is shown as its other people; a deleted person's direct message (`is_user_deleted`) is left out.
Why: `users.info` is Tier 4 (100+ a minute), so a first listing with hundreds of direct messages can be told to slow down; a person not named stays an id until the next listing. `users.list` would name everyone at once but pages through the whole workspace.
Verify: apps/agent-world/tests/integrations/slack.test.ts

`invalid_auth`, `not_authed`, `token_revoked`, `token_expired`, and `account_inactive` become a refusal with `signIn: "slack"`.
Why: a web session ends when the operator signs out of Slack in a browser or the workspace rotates it; the UI then offers sign-in again instead of an error.

## symbol:openSlack

`channel(id, at)` opens at a message found by search: `conversations.history` with `latest=at`, `inclusive`, 25 (the newest in range, as documented) and with `oldest=at`, 50; the later messages are shown only when that read has no `has_more`, else none, and `newer` is set. The panel then says newer messages follow and keeps Mark read off, since the newest shown is not the channel's newest.
Why: docs.slack.dev/reference/methods/conversations.history does not say whether an `oldest`-only read answers from `oldest` forward or with the newest in range; taking all or none of the later messages never shows a gap after the message either way.
Coupled: apps/agent-world/web/overlay/places/square.tsx
Verify: apps/agent-world/tests/integrations/slack.test.ts, apps/agent-world/tests/world-square.test.ts

A channel or thread reads with `lastRead`, the newest message the operator has read, so the panel opens at the first new one: for a channel, the `last_read` the last `client.counts` gave (kept in `lastRead` for every row, read or not), else `conversations.info`'s `channel.last_read`; for a thread, the parent's `last_read` in `conversations.replies` (Slack gives it only for threads the operator follows; otherwise null). Reading calls only these read-only methods; nothing is marked read by opening.
Why: ticket 05 of `.ledger/202610191114-agent-world-alive/` (the operator decided Slack is marked read only by an explicit button). wee-slack reads the same fields (`slack/slack_conversation.py`: `last_read` from `conversations.info`; `slack/slack_message.py`: "Only subscribed threads have the last_read property").
Verify: apps/agent-world/tests/integrations/slack.test.ts

`markRead` is Mark read, with the web client's calls for an `xoxc` session: a channel through `conversations.mark` (`channel`, `ts` of its newest message), a thread through `subscriptions.thread.mark` (`channel`, `thread_ts`, `ts` of its newest reply, `read=1`; undocumented, the web client's method). Only the gate calls it, through `act`, which needs no confirmation.
Why: docs.slack.dev/reference/methods/conversations.mark documents the channel call; the Web API has no documented call for a thread's read state. wee-slack, which signs in with the same `xoxc` token and `d` cookie, calls both exactly so (`slack/slack_api.py`: `conversations_mark`, `subscriptions_thread_mark`; read 2026-10-19 from github.com/wee-slack/wee-slack).
Coupled: apps/agent-world/src/backend/integrations/gate.ts, apps/agent-world/src/backend/integrations/index.ts
Verify: apps/agent-world/tests/integrations/slack.test.ts
