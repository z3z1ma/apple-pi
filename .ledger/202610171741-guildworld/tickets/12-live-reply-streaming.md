# 12: Live reply streaming

**What to build:** A reply streams while the agent writes it. The bridge forwards assistant text deltas as a transient message that the runtime relays only to clients subscribed to that session, and never stores. The client replaces the streamed text with the stored entry named at turn end. A slow client cannot back up the bridge.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] In the session-state runtime tests, a subscribed client receives a faux session's reply deltas in order, and an unsubscribed client receives none.
- [ ] No streamed text is written to `events` or `messages`; the entry named by `turn_end` holds the full reply.
- [ ] A client that stops reading does not delay the bridge or other clients.
- [ ] The bridge streams for child sessions too.
