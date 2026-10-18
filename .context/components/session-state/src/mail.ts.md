## file

A session's own `custom_message` entries of `MAIL_CUSTOM_TYPE` (on every branch, from `getEntries()`) are the delivery record: mail is applied only when the transcript holds it, and the runtime sends every mail not yet applied to each new bridge, which skips ids already recorded.
Why: a mail marked done when Pi merely queued it is lost when the process ends before the queue is delivered (closing a busy worker), and reading `getBranch()` instead would redeliver after `/tree` plus a restart.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/runtime.ts
Verify: components/session-state/tests/mail.test.ts

The custom type keeps its old name, `apple-pi.mailbox-message`.
Why: transcripts written before mail moved onto the database use it; they must still render and count as delivered.

## symbol:deliverMail

While the process is starting up (a `startup` session start, before its first run), mail rides the next turn instead of a steer with `triggerTurn`.
Why: the host submits its own prompt (`pi -p "..."`, `pi "brief"`) right after `session_start`, and Pi rejects that prompt with "Agent is already processing" when an extension has already started a turn. The operator chose this over delivering at once.
