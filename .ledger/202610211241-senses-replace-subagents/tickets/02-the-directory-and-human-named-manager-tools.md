# 02: The directory and human-named manager tools

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** `directory` replaces `list_peer_sessions`: everyone in the caller's organization with name, title, team, manager, what they work on, and working, idle, or asleep; former members on request. The six manager tools get human names with unchanged behavior: `hire` (was `start_peer_session`), `rehire` (`reopen_peer_session`), `send_home` (`close_peer_session`), `let_go` (`retire_peer_session`), `move` (`transfer_peer_session`), `rename` (`rename_peer_session`). `schedule` becomes `remind_me(when, text)` for every person. The `<org>` and `<manager>` charters use the new names.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] `directory` from a leaf lists exactly its organization with each field; with former members requested, retired people appear with when and why they left.
- [ ] Each renamed manager tool does what its predecessor did (the existing organization tests pass against the new names), and only managers and roots have them.
- [ ] `remind_me` delivers its text as a turn at the given time, as `schedule` did.
- [ ] None of `list_peer_sessions`, `*_peer_session`, or `schedule` exists (package-load test), and no prompt or doc names them.
