# 04: Modals reopen where you left them

**What to build:** `/work` reopens on the last tab and selection, and the task viewer reopens each task at its last scroll position; a viewer that was following a running task's live output keeps following it. This state lasts for the Pi process only and never enters the session file. Update `docs/subagents.md` and `docs/tasks.md`. See `../spec.md`.

**Blocked by:** None (can start immediately).

**Status:** done

- [x] After `/work` closes and reopens, it shows the last tab and selected row.
- [x] After the task viewer closes and reopens on the same task, it keeps its scroll position, or keeps following the live output if it was.
- [x] Freshly installed extensions (a restart) start with no restored state.
- [x] Restoring state never calls `pi.appendEntry` or other session persistence.
