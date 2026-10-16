Status: in-progress
Created: 2026-10-16
Updated: 2026-10-16

# Session mailbox: durable per-session inbox that steers the agent

## Intent

Give every root Pi session a durable mailbox. Anything that can write a file (another agent, a headless `pi -p` run, a shell script, a clock) can send it a message, and the session receives each message as a steer: at the next safe boundary during a run, or as a new turn while idle.

This is the communication backbone for [Shikamaru](../202610161427-shikamaru/task.md): workers report to the chief of staff, the chief of staff redirects workers, and sweeps or clocks wake the chief of staff. All of them use the same mechanism.

## Decisions

- **First-class apple-pi feature.** It is not an agent convention on top of `monitor`.
- **The mailbox belongs to the session id.** One mailbox per session, keyed by the same id as the session JSONL and stored outside it. Stable identities come from Pi itself: `pi --session-id <id>` accepts any id matching `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$` (checked by `assertValidSessionId` in the installed Pi package, `dist/core/session-manager.js`), so `pi --session-id shikamaru` always reopens the same session and mailbox. `/fork` and `/clone` create a new session id and so a new, empty mailbox, which is correct because a fork is separate work. `/tree` keeps the id. A process-bound address was considered and rejected as unneeded once `--session-id` gives stable ids.
- **The session itself records what was delivered; there is no cursor.** Each delivery is a `pi.sendMessage` steer whose `custom_message` entry carries the mailbox message id in `details`. A message counts as delivered exactly when that entry exists in the session's entries, on any branch.
  - *Delivery rule:* on session start and on each wake, the reader delivers every mailbox message whose id is neither in the session's entries nor in its own in-memory set of steers that are queued but not yet appended by Pi.
  - *Why entries are durable enough:* Pi's `SessionManager._persist` (installed package, `dist/core/session-manager.js`) writes each entry with a synchronous `appendFileSync` as it is appended; a brand-new session first writes its whole file when the first user or assistant message arrives. A crash before the entry is appended loses the in-memory entry too, so the message is delivered again on the next open: at-least-once.
  - *Branches:* after `/tree` moves to a branch that does not contain the entry, the message is not delivered again, because it was already acted on and redelivery would repeat that work. It reaches the new branch only as Pi's branch summary carries it, like any other abandoned-branch content.
- **The stored log is authoritative; file watching only wakes the reader.** On session start and on every wake, the reader compares the mailbox with the session's entries. Watch notifications can coalesce or drop, so they never decide what is delivered. Plain `tail -F` is unsuitable: it replays the last 10 lines on start and skips messages sent while Pi was closed.
- **Messages wait for their session.** A message to a session that is not running stays in the mailbox until that session opens.
- **Storage needs no lock.** Each mailbox is an append-only JSONL file, one line per message. Senders only append one line; the reader never writes it. A single JSON file with a cursor and a message array was rejected because concurrent senders would need a lock.
- **One process per session id is a precondition, not something the mailbox guards.** Pi does not prevent two processes from opening the same session id (`session-manager.js` has no lock), and two such processes already append conflicting entries to the same JSONL. With a mailbox, both would also act on the same message, and message ids cannot undo duplicate side effects across processes. Launchers (Shikamaru) start a session only when no live process holds it, for example by checking the tmux state records. The mailbox adds no guard: the operator decided this edge case is self-inflicted in a personal harness and not worth machinery.
- **Sending.** A tool for agents (taught by its description) and a shell command for senders outside Pi, writing the same message shape: `{id, from, ts, body}`.
- **Old waiting messages get no special handling.** Messages for a session that has not opened in a long time simply wait. Anyone who cares (Shikamaru) can read the mailbox files directly.
- **The code lives in `components/tasks`**, which already delivers steers. Persistent mailbox state changes the "no persistent scheduler state" boundary in `docs/scheduling.md` and the in-memory, session-local lifecycle in `docs/tasks.md` and `docs/boundaries.md`; those pages are updated with the change.
- **Queue reservations.** Ids sent as steers but not yet recorded are reserved per session id on `globalThis`, because Pi's queue survives an extension reload. A completed run clears them (Pi keeps running while its queue holds messages); an aborted run keeps them, so a message discarded by Escape is redelivered after the next completed run without restarting the cancelled work.
- **Only root sessions get the send tool.** Child sessions and `pi_exec` workers send by appending through `bash` or the shell command.

## Acceptance criteria

1. A message sent while no process has session X open is delivered once `pi --session-id X` opens, exactly once in the absence of a crash. At process startup it rides the first run (the command's prompt, the operator's first message, or the next mailbox message) instead of starting one, so the command's own prompt is never rejected (operator decision after review).
2. A message sent during a run arrives at the next safe boundary, as monitor events do today.
3. A message sent while the session is idle starts a turn.
4. Several senders appending at the same moment lose and corrupt nothing: every message is delivered.
5. A message counts as delivered only when its `custom_message` entry is in the session: a crash after the steer is queued but before Pi appends it redelivers that message on the next open.
6. Each delivered message appears in the session JSONL with its `id`, `from`, `ts` and `body`, so a repeat is recognizable.
7. `/fork` and `/clone` give the new session an empty mailbox, and messages to the original id are not delivered to the fork. `/tree` and reload neither replay nor lose messages.
8. Root sessions have the send tool; child sessions and `pi_exec` workers do not. The shell command works without any Pi process running.
9. `docs/scheduling.md`, `docs/tasks.md` and `docs/boundaries.md` describe the mailbox and its persistent state; the package-load test reflects the new tool.
10. `npm run format:check`, `npm run lint`, `npm run typecheck` and `npm test` pass.

## Current State

In progress. Implemented in `components/tasks` (`mailbox.ts`, `mailbox-tool.ts`, `scripts/pi-send.mjs`) with tests in `components/tasks/tests/mailbox.test.ts`; docs updated. Review findings fixed: Escape loss, reload duplicate, unreadable-mailbox crash, startup prompt race. Full `npm test` passed on the final tree (1519 unit, 23 sidebar, 118 pair, loader). Committed; task left open for operator review.

## Outcome

Pending.
