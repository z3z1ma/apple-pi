# 05: Slack reading

**What to build:** A channel or thread opens scrolled to the first new message, or to the bottom when nothing is new. A Mark read button marks it read in Slack as the operator; opening alone changes nothing in Slack. A channel marked read leaves the square's townsfolk.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] Opening a channel with unread messages shows the first new message at the top of the view, with the New divider above it; a channel with none opens at the bottom.
- [ ] Mark read sends Slack's mark call for that channel (or thread) with the newest message's timestamp, against the fake Slack server in the backend test, logs it in the chatbox and the local record, and the townsperson leaves the square.
- [ ] Opening and reading a channel makes no Slack call that changes read state.
- [ ] Judged on screenshots in all three themes against `apps/agent-world/art/STYLE.md` and the polish bar in `.ledger/history/202610171741-guildworld/spec.md` (Further Notes).
