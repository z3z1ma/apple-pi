Type: interrogation
Status: resolved
Blocked by: 01, 04, 05

# Commands back into sessions

## Question

Which typed commands can consumers send back, and how is each delivered and acknowledged?

Start from talk (a new user turn), steer, follow-up, answer a questionnaire, abort, mark seen, and start or reopen a session in tmux. Decide the command record, how the bridge delivers each, what acknowledgement means (accepted, delivered, recorded, done), idempotency, and how a command aimed at a stale incarnation fails.

## Answer

Decided with the operator, 2026-10-18.

- **Commands:**
  - conversation: talk (a new user turn, only when the session is idle), steer (redirect a busy run), follow-up (queue after the run), answer an open questionnaire, abort;
  - attention and mail: mark seen; send mail to a session (replacing the mailbox's direct file writes by `mailbox_send` and `pi-send.mjs`);
  - session lifecycle: start a new session in a tmux window (cwd, name, `reportsTo`, first prompt), reopen a stopped session by id, close a session (quit Pi or close its window);
  - settings: rename, change model or thinking level.
- **Staged receipts:** each command records its stages as events: accepted (stored), delivered (the target incarnation's bridge received it), applied (Pi accepted it: steer queued, turn started, answer submitted, abort finished), or failed with a reason. "Done" is never claimed; the effect appears as ordinary observed events.
- **No live incarnation:** talk, steer, follow-up, answer, abort, rename, and model changes fail at once with "not running"; mail waits and is delivered when the session next opens. A command bound to one incarnation never reaches a later one.
- **Questionnaires:** `ask_user_question` publishes its questions through the bridge and accepts an answer from either the terminal or the runtime, whichever comes first; the other side then closes. This needs a change in `ask_user_question`. Other extensions' select, confirm, and input dialogs stay terminal-only until each adopts the same pattern.
- **Retries and authority (agent's proposal, not contested):** each command carries a client-chosen id so a retried send applies once; anyone who can open the socket (only the operator's user) may send commands; confirmations, such as before closing a busy session, belong to each view.
