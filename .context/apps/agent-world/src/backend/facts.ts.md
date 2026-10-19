## symbol:factsOf

`status`, `unseen`, and `needsYouSince` follow the tmux sidebar exactly: asking is an open `prompt`; working is any `run_state` but `idle`; finished-and-unseen is `needs_you_since` set with no prompt open. The runtime owns `needs_you_since`; nothing here recomputes it from `seen_at` and `settled_at`.
Why: every view (sidebar, dashboard, notch, orbs) must agree on who needs the operator; the backend test runs the sidebar's own `model.live()` against the same database and compares.
Coupled: components/tmux-sessions/sidebar/model.py, apps/agent-world/web/overlay/interface/model.ts
Verify: apps/agent-world/tests/backend.test.ts

## symbol:taskReader

A task's title and status are read from the bundle's `task.md` as the sidebar's `ledger_task` reads them (first `# ` heading, first `Status:` line), falling back to the task id; files are reread only when their mtime changes.
Why: the runtime records only the bundle path in `current_task`; an archived bundle moves under `.ledger/history/`, and the sidebar shows the task id then too.
Coupled: components/tmux-sessions/sidebar/model.py
