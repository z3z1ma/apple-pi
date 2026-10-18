# 14: Sidebar and dashboard on the database

**What to build:** The Textual sidebar and dashboard read the shared database directly (read-only) and show the richer facts; marking seen and the dashboard's reply go to the runtime as commands (the reply as talk) instead of tmux option writes and `send-keys`.

**Blocked by:** 05 Relations and work links; 13 Attention and tmux glue

**Status:** ready-for-agent

- [ ] Against a database fixture created by the runtime's own migrations, the sidebar shows each session's name, status, current tool, ledger task, cost, context, and needs-you lane as recorded.
- [ ] The dashboard's reply to an idle session sends a talk command, and to a busy session offers no reply, as today.
- [ ] Marking seen from the sidebar sends a mark-seen command.
- [ ] The views no longer import `agents.py` or read tmux state records.
- [ ] The sidebar pytest suite passes against the migrated fixture.
