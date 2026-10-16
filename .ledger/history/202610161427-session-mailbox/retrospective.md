Status: done
Created: 2026-10-16
Updated: 2026-10-16

# Retrospective

## What Mattered

- Pi already had the pieces: `--session-id` gives stable named sessions, and the session's own `custom_message` entries are a durable delivery record. Using both removed a planned address layer and a cursor file.
- Independent review found four real lifecycle defects the first tests missed: Escape discarding a queued steer, reload resending a still-queued steer, an unreadable file crashing Pi from the `fs.watch` callback, and startup mail making the host's own prompt fail.

## Learnings

- Pi's `pendingMessageCount` and `hasPendingMessages()` count only user text steers; custom steers show only in `session.agent.hasQueuedMessages()`. A test that waited on the wrong counter passed through a tool error.
- A completed run has recorded every queued steer (Pi keeps running while its queue holds messages); an aborted run may discard or keep its queue. Deliver on `agent_settled`, not `agent_end`.
- Pi emits `session_start` on reload only when a host has bound to the session; faux-session tests must bind (for example `bindExtensions({ onError })`) to exercise reload.
- A test is only evidence after a mutation shows it fails without the code it covers; two tests here passed with their target removed.
- Pi stores a mailbox steer as a `custom_message` entry, but the model receives it with role `user`; assert turn order on that form.

## Improvements

- Run the independent review before the first full-suite run; its findings changed the code twice after the suite had passed.
