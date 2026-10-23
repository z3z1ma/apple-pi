# 04: Escalation, and the operator as a person

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** `escalate(body)` writes to the caller's manager; a manager may escalate further; at a root it writes to the operator. The operator is a person in the directory at the top of every tree, and anyone can mail him. Mail to him shows as needing him in Agent World's Mail tab and in the sidebar, and his replies from either reach the thread as messages, not as prompts in someone's session. `ask_user_question` stays the way to interrupt him now.

**Blocked by:** 01 Mail is threads, 02 The directory and human-named manager tools

**Status:** done

- [x] `escalate` from a leaf reaches its manager; from a root it reaches the operator and the root keeps working.
- [x] The operator is listed in `directory` and can be addressed by `send_mail`.
- [x] A thread to the operator shows as needing him in the sidebar and in Agent World's Mail tab until he reads it.
- [x] A reply sent from the sidebar or Agent World arrives in every participant's session as a thread message.

**Evidence:** Session-state, organization, and the focused Agent World backend suites: 29 files / 114 tests passed. Sidebar: 29 tests passed. Built Agent World interface/build tests: 12 passed, with a focused repeat of the inbox case after styling. Node/web typecheck, package loader, scoped Biome, and Python lint passed. Inspected the inbox screenshot with the existing fantasy skin. The new tests assert unread state, exact read cursors, non-blocking escalation, and reply-to-all through mail rather than session prompts.

**Deviations:** The operator's needs-you state is derived from its thread read cursor, not a fabricated session row or a copy in `sessions.needs_you_since`. The world keeps its existing delivery-traffic view alongside the operator's conversation inbox; outside scripts still use plain mail. The sidebar opens its inbox with `m` or the Mail button.
