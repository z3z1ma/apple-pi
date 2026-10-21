## symbol:factsOf

`status`, `unseen`, and `needsYouSince` follow the tmux sidebar exactly: asking is an open `prompt`; working is any `run_state` but `idle`; `unseen` is `needs_you_since` set with no prompt open, and it stays set through a later run, so the views rank a working status above it and mark it beside the state (the interface's `attentionOf`, the sidebar's `state`, the notch). The runtime owns `needs_you_since`; nothing here recomputes it from `seen_at` and `settled_at`.
Why: every view (sidebar, dashboard, notch, orbs) must agree on who needs the operator; the backend test runs the sidebar's own `model.live()` against the same database and compares.
Coupled: components/tmux-sessions/sidebar/model.py, components/tmux-sessions/sidebar/presentation.py, components/tmux-sessions/notch/NotchShell.swift, components/session-state/src/attention.ts, apps/agent-world/web/overlay/interface/model.ts
Verify: apps/agent-world/tests/backend.test.ts, apps/agent-world/tests/world-interface.test.ts

## symbol:taskReader

A task's title and status are read from the bundle's `task.md` as the sidebar's `ledger_task` reads them (first `# ` heading, first `Status:` line), falling back to the task id; files are reread only when their mtime changes.
Why: the runtime records only the bundle path in `current_task`; an archived bundle moves under `.ledger/history/`, and the sidebar shows the task id then too.
Coupled: components/tmux-sessions/sidebar/model.py

With `recheck` false a file read before is returned from the cache without a `stat`, and a missing file is cached too (as unread), so only the backend's task rereads stat the inn's sleepers' files.
Why: with thousands of sleepers, a `stat` per sleeper on every event was a large share of each read.
Coupled: apps/agent-world/src/backend/world-backend.ts

## symbol:parseShared

Parsed values are shared by every caller and every read (one cache for the process); nothing may change them.
Why: the `git`, `config`, and `current_task` strings repeat from read to read, and parsing them for every sleeper on every read was measurable; a caller that mutates a value would change it for all.

## symbol:asking

Only a prompt of kind `questionnaire` whose `id` and every question parse (text, at least one option, each with a label) carries `questionnaire`; anything else is shown as a dialog answered in its terminal.
Why: the `answer` command names the prompt's `id` and must give one reply per question in order, so a half-read questionnaire would send answers the tool refuses; the panel then points to the terminal instead of showing a form it cannot send.
Coupled: components/session-state/src/bridge.ts, apps/agent-world/web/overlay/conversation/question-form.tsx
Verify: apps/agent-world/tests/instruct.test.ts

## symbol:factsColumns

`intent` is selected only when the database has the column (`world-backend.ts` checks `pragma_table_info` on each read); otherwise it reads as null. The organization's columns (`role_title` as `title`, `soul`, `self`) are selected the same way; `selfHeadings` are the Markdown headings of the `self` text, since the card shows what a person keeps notes under, never the notes.
Why: the session-state runtime is a long-lived daemon that keeps running old code after the checkout changes, so its database can lack a newly migrated column for days; selecting a missing column fails the whole read and the world goes empty.
Coupled: apps/agent-world/src/backend/world-backend.ts, components/session-state/src/schema.ts, components/tmux-sessions/sidebar/model.py
Verify: apps/agent-world/tests/backend.test.ts
