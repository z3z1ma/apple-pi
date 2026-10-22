# 01: Mail is threads

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** Every exchange between people is a thread stored by the runtime: a subject, participants (each with push or pull delivery), and ordered messages. Every person gets `send_mail(to, cc?, subject, body)` (people, `my-team`, or `my-manager`), `reply(thread, body)` (to everyone in the thread), `inbox()` (threads with what is new), and `read_thread(thread)`. A pushed message arrives as mail does today (queued while asleep, recorded on disk when delivered, sent again on reopen) and shows its thread id, subject, and sender. `mailbox_send` is removed. The `<org>` charter teaches the tools and push versus pull.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] In a faux session, `send_mail` to two people with one copied creates one thread; each of the three receives the message with its thread id, subject, and sender.
- [ ] `reply` from a recipient reaches the sender and the other participants, and `read_thread` shows all messages in order.
- [ ] `my-team` and `my-manager` expand to the tree's members; mail to a sleeping person waits and arrives when it reopens, and the sender is told it waits.
- [ ] `inbox` lists only threads the caller is in, with the count of messages it has not read.
- [ ] `mailbox_send` no longer exists (package-load test), and no view or tool reads mail from anywhere but threads.
