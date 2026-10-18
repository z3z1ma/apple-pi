# 10: Mail on the model

**What to build:** Mail between sessions moves into the database: `mailbox_send` sends a mail command through the session's bridge, `pi-send.mjs` sends one over the socket (starting the runtime if needed), the receiving bridge delivers with today's rules (steer during a run, new turn when idle, next turn at session start, at least once), mail to a stopped session waits until it opens, and a worker started with `--reports-to` still mails its supervisor when it closes. The mailbox JSONL files and their watcher are removed.

**Blocked by:** 08 Command channel

**Status:** ready-for-agent

- [ ] Mail from one faux session to another arrives as a steer during a run and as a new turn when idle, and the database records sender, receiver, sent time, and delivery.
- [ ] Mail sent to a stopped session is delivered in its next turn after it opens, and the database shows it waiting until then.
- [ ] `pi-send.mjs` with no runtime running starts one and delivers the mail.
- [ ] A worker closing (not reloading) mails its supervisor the same close notice as today.
- [ ] No mailbox JSONL file is written or read anymore.
