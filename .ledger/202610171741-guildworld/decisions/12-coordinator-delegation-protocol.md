Type: interrogation
Status: resolved
Blocked by: 01, 05, 18

# Coordinator delegation protocol

## Question

How does Agent World ask a coordinator to plan or start work, and how does it learn the outcome?

Decide the request envelope sent through the mailbox, how the coordinator acknowledges it (a reply to Agent World's own mailbox, a ledger field, a new Pi tool), how a request is correlated with the workers and ledger threads it produces, idempotency, and what changes in the coordinator skill or apple-pi. Cover several coordinators and several tmux servers.

## Answer

Decided with the operator, 2026-10-18. No delegation protocol of its own: the pieces already decided carry it, and freedom beats structure here.

- **Asking:** the operator talks to the coordinator in the conversation panel ([Dialogue with a character](17-dialogue-with-a-character.md)), with the session-state `talk`, `steer`, and `follow_up` commands; there is no request envelope.
- **Acting:** the coordinator starts, reopens, and closes workers with its lifecycle tools (`start_session` and the others, behind `pi --coordinator`); workers report to it.
- **Learning the outcome:** the world observes it: new sessions and their state, each worker's ledger task, mail between workers and the coordinator (visible traffic), and the coordinator's replies in its conversation. Acknowledgement is the command receipt plus what the coordinator says.
- **No required link from a worker to a coordinator thread.** The coordinator may start a party with no ledger task, or before one exists; the operator was dubious even of an optional thread field. The world groups workers by the coordinator they report to and shows each worker's own task; any thread link is derived opportunistically, never required.
- **Several coordinators** each have their own headquarters; nothing here assumes one.
