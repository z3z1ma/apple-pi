# 03: Team channels

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** Each manager has a team channel whose participants are the manager and its reports, all pulled. `post(channel, body)` writes there (or in a team channel the caller was invited to). Naming a participant in a post pushes that post to them. Channels are read with `read_thread` and appear in `inbox`.

**Blocked by:** 01 Mail is threads

**Status:** done

- [x] A post in a team channel does not start a turn for any member; each member's `inbox` shows it as new.
- [x] A post naming one member is delivered to that member as a turn, and to nobody else.
- [x] A person moved to another manager leaves the old channel and joins the new one.
- [x] A person not in a channel and not invited cannot post there and is told why.

**Evidence:** The new channels suite exercises pull-only posts, inbox/read_thread, a named participant receiving a turn, later unaddressed replies staying pulled, transfers, outsider refusal, and invitation. Session-state and organization: 26 files / 108 tests passed. Node and web typecheck and package loader passed.

**Deviations:** `post` has an optional `invite` list so the approved cross-team invitation has an actual tool path, without introducing another tool. Mentions match complete names or ids, case-insensitively, with an optional `@`; substring matches do not notify someone.
