## file

The session's own `custom_message` entries (on every branch, from `getEntries()`) are the delivery record; there is no cursor. Reading `getBranch()` instead would redeliver a message after `/tree` plus a restart.
Why: a cursor advanced before Pi records the steer loses the message on a crash, and the entries are written with a synchronous append as Pi records them.

The message line format (`{id, from, ts, body}`), the directory rule (`PI_MAILBOX_DIR`, else `<PI_CODING_AGENT_DIR or ~/.pi/agent>/state/mailbox`) and the session-id regex are written twice: here and in the standalone sender script.
Why: the script runs under plain Node without Pi, so it cannot import this TypeScript module.
Coupled: components/tasks/scripts/pi-send.mjs, vitest.config.ts

Verify: components/tasks/tests/mailbox.test.ts

## symbol:reserved

Reservations (ids sent as steers that Pi has not yet recorded) live on `globalThis` per session id, not in `installMailbox`. They are cleared on every `session_start` except `reload`, and on every `agent_settled` that was not aborted.
Why: Pi's agent queue survives an extension reload, so a fresh module copy with an empty set would resend a still-queued message. A completed run has recorded every queued steer, because Pi keeps running while its queue holds messages. An aborted run may have discarded its queue (Escape calls `clearQueue`) or kept it (RPC abort), so its reservations wait for the next completed run.

## symbol:installMailbox

At `session_start` with reason `startup`, waiting mail is sent as `nextTurn`, not as a steer with `triggerTurn`.
Why: the host submits its own prompt (`pi -p "..."`, `pi "brief"`) right after `session_start`, and Pi rejects that prompt with "Agent is already processing" when an extension has already started a turn. The operator chose this over delivering at once.

Deliver on `agent_settled`, never on `agent_end`.
Why: during `agent_end` the run is still active, so a steer sent then joins a finished run's queue.

The `fs.watch` callback runs outside Pi's extension error boundary, so it catches its own errors; an uncaught `EACCES` from an unreadable mailbox would end the Pi process. A watcher `error` closes only the watcher and keeps `active`, so delivery continues when runs complete.
