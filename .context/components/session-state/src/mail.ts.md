## file

A session's own `custom_message` entries of `MAIL_CUSTOM_TYPE` (on every branch, from `getEntries()`) are the delivery record: mail is applied only when the transcript holds it and the session file exists (Pi writes a new session's file only once it holds a user or assistant message; the bridge waits for one), and the runtime sends every mail not yet applied to each new bridge, which skips ids already recorded.
Why: a mail marked done when Pi merely queued it is lost when the process ends before the queue is delivered (closing a busy worker), and reading `getBranch()` instead would redeliver after `/tree` plus a restart.
Coupled: components/session-state/src/bridge.ts, components/session-state/src/runtime.ts
Verify: components/session-state/tests/mail.test.ts

The custom type keeps its old name, `apple-pi.mailbox-message`.
Why: transcripts written before mail moved onto the database use it; they must still render and count as delivered.

## symbol:installMail

Steering is set to `all` on the live `AgentSession` at every `before_agent_start`, not once.
Why: extensions have no API for it, `AgentSession.setSteeringMode` would write the user's global settings, and Pi resets the mode from settings on reload.

Mail expansion reads the live thinking-visibility setting when drawing, independently of tool expansion. The session must be registered before extension binding emits `session_start`, including before the first prompt.
Why: Pi rebuilds custom messages when tool expansion changes, but thinking toggles can only request a redraw. Reading the setting in the renderer-registration callback would leave already displayed mail stale; waiting for a first prompt would leave restored history stale.
Coupled: components/shared/src/forked-continuation.ts
Verify: components/session-state/tests/mail.test.ts, components/session-state/tests/mail-render.test.ts

## symbol:deliverMail

While the process is starting up (a `startup` session start, before its first run), mail the runtime replays (mail that waited for this process) rides the next turn; live mail still starts a turn instead of a steer with `triggerTurn`.
Why: the host submits its own prompt (`pi -p "..."`, `pi "brief"`) right after `session_start`, and Pi rejects that prompt with "Agent is already processing" when an extension has already started a turn. The operator chose this over delivering at once.
