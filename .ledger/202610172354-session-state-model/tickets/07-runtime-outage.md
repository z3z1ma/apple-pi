# 07: Runtime outage

**What to build:** Sessions keep working when the runtime is down; when it returns, each bridge reconnects and sends its full current state, and the database records a gap instead of inventing the events it missed.

**Blocked by:** 03 Rich activity

**Status:** ready-for-agent

- [ ] Killing the runtime while a faux session works does not disturb the session.
- [ ] Starting the runtime again (or letting a bridge start it) brings the session's current state, including activity, back into the database within a few seconds of reconnect.
- [ ] The event history shows a gap event covering the outage for that session and no fabricated events from inside it.
- [ ] History written before the outage is intact after restart.
