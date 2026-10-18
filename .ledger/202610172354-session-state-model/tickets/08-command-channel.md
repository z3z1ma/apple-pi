# 08: Command channel

**What to build:** Consumers send commands over the socket and get staged receipts: talk (only when idle), steer, follow-up, abort, rename, and model or thinking-level changes. Each command carries a client-chosen id (a repeat applies once), is bound to the target's current incarnation, and fails at once with "not running" when there is none.

**Blocked by:** 03 Rich activity

**Status:** ready-for-agent

- [ ] A talk command to an idle faux session starts a turn with that text; its receipts read accepted, delivered, applied, in that order, as events.
- [ ] A talk command to a busy session fails with a reason; steer and follow-up to a busy session are delivered as steer and follow-up.
- [ ] An abort command stops a running turn and its receipt reaches applied when the run has aborted.
- [ ] Rename, model, and thinking-level commands change those facts in the session and in the database.
- [ ] Sending the same command id twice applies it once.
- [ ] A command to a session with no live incarnation fails at once with "not running"; a command bound to an earlier incarnation never reaches a reopened session.
- [ ] No receipt ever claims done.
