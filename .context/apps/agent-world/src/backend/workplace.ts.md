## symbol:workplaceReader

The snapshot carries open meetings, team channels for active organizations, live registered tasks, and read-only backlog discovery. Mail traffic and the operator inbox retain their existing owners. Message and goal bodies cross the window bridge only when opened, so old conversations do not accumulate in every IPC update.

Ledger discovery mirrors the native directory: ancestor `.ledger` directories, valid live bundle names, no recursive search or symlinked ledger directory, no registration on discovery. A registered bundle belongs only to its runtime organization; an unregistered bundle may be visible to multiple organizations sharing a directory. Files are rediscovered on the backend's existing task-reread cadence, or when directory membership changes. Goal metadata shares the cached task reader. A held assignment remains visible even if someone writes `Status: done` or archives the ledger file; only finishing or unassigning ends that ownership. Closed unassigned goals stay out of the backlog.
Why: assigning on discovery would restore the implicit work binding this task removes; rescanning directories on every streaming event would undo the backend's file-read cost controls.
Coupled: components/session-state/src/work-read.ts, components/shared/src/ledger-files.ts, apps/agent-world/src/backend/facts.ts, apps/agent-world/src/backend/world-backend.ts
Verify: apps/agent-world/tests/workplace.test.ts

The native `escalate` tool records the explicit `escalation` thread kind; an unread operator participant supplies attention. Subject-only legacy mail is unclassified, not inferred to be an escalation. Delivery and read cursors remain ordinary thread behavior, independent of the sender's run state and `needs_you_since`.
Why: a display subject does not establish an escalation's purpose. The explicit kind must reach this reader together with the native writer change or operator escalation attention disappears.
Coupled: components/session-state/src/mail.ts, apps/agent-world/src/backend/mail.ts
Verify: apps/agent-world/tests/workplace.test.ts

## symbol:openWorkplace

The operator can observe shared channel, meeting, and task threads without joining them or advancing anyone else's read cursor. If already a participant, the ordinary mailbox read marks only the returned sequence. Private mail still uses the operator's participant-only inbox path.

A task read accepts only an id or bundle on the current board, not an arbitrary renderer path. Giving work sends the ordinary runtime `work/assign` as `operator` and waits for its receipt; it never edits assignments or the world snapshot. The runtime owns authorization, focus, notification, and waking a sleeping assignee. The UI supplies the operator's most recently active attached tmux pane through the same lookup as the inn's wake action: the operator is not a session, so it has no incarnation from which the runtime could infer one.
Coupled: apps/agent-world/src/backend/mail.ts, apps/agent-world/src/backend/commands.ts, apps/agent-world/src/backend/inn.ts, apps/agent-world/src/electron/main.ts, components/session-state/src/work.ts
Verify: apps/agent-world/tests/workplace.test.ts, apps/agent-world/tests/inn.test.ts

Joining or leaving a channel sends `channel_membership` as `operator` and waits for the receipt. It does not write the database, mark the channel read, or filter the operator inbox. The ordinary event poll refreshes the snapshot, including participants, because the runtime's audience event advances `events.seq`. The UI reads the channel after an applied receipt when it wants the now-visible history acknowledged.
Why: a local membership write would be a second store, and marking read inside the membership call would hide history the operator had not opened. The inbox query already lists every thread the operator is in; excluding channels here would change that read.
Coupled: apps/agent-world/src/backend/mail.ts, apps/agent-world/src/backend/commands.ts, apps/agent-world/src/electron/main.ts, components/session-state/src/runtime.ts
Verify: apps/agent-world/tests/channel-membership.test.ts
