# 05: Relations and work links

**What to build:** The model holds supervision (`--reports-to`, now read by the bridge), lineage (fork or clone through Pi's `parentSession`, and resume or switch within one pane), each session's git repository, branch, and worktree, and time-stamped links between a session and the ledger tasks it creates, changes status of, or edits, with the latest link as its current work item.

**Blocked by:** 01 Runtime and bridge tracer; 02 tmux topology and pane binding

**Status:** done

- [x] A session started with `--reports-to X` shows supervision by X.
- [x] A session forked or cloned from another shows lineage to its source; switching or resuming to another session in the same pane records that succession.
- [x] A session whose cwd is a git worktree shows its repository, branch, and worktree; changing branch through a tool updates it.
- [x] When a session runs `ledger_add`, `ledger_status`, or edits a ledger task file, a time-stamped session-to-task link appears, and the session's current work item is the most recent link; a session with no links shows none.
- [x] Each relation change is an event.
