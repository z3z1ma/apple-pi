# 03: Team channels

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** Each manager has a team channel whose participants are the manager and its reports, all pulled. `post(channel, body)` writes there (or in a team channel the caller was invited to). Naming a participant in a post pushes that post to them. Channels are read with `read_thread` and appear in `inbox`.

**Blocked by:** 01 Mail is threads

**Status:** ready-for-agent

- [ ] A post in a team channel does not start a turn for any member; each member's `inbox` shows it as new.
- [ ] A post naming one member is delivered to that member as a turn, and to nobody else.
- [ ] A person moved to another manager leaves the old channel and joins the new one.
- [ ] A person not in a channel and not invited cannot post there and is told why.
