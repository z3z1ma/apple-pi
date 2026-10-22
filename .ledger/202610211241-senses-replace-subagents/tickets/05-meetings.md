# 05: Meetings

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** A manager calls `meet(people, agenda)` to open a meeting thread whose participants are all pushed. Everyone answers in the thread until the organizer calls `end_meeting(thread, summary)`, which sends the summary to everyone and closes the thread. There is no cap on rounds.

**Blocked by:** 01 Mail is threads

**Status:** done

- [x] `meet` delivers the agenda to every invited person as a turn, and each reply reaches every other participant.
- [x] `end_meeting` delivers the summary to every participant and further replies to that thread are refused.
- [x] Only the organizer can end the meeting.

**Evidence:** Faux-session meetings cover pushed agendas, reply-to-all, organizer-only closure, the delivered conclusion, and refused late replies. Thread recovery tests seed both accepted-post crash boundaries and verify one message and a complete outgoing queue; a forced queue-write failure leaves neither a summary nor a closed meeting. Focused suites: 15 tests passed; Node/web typecheck and package loader passed. A broader domain run had two existing tests waiting for a `gap` event that a reconnect does not always emit. Those tests now wait for the facts the rebind actually changes; both affected files passed on rerun.

**Deviations:** The meeting summary, closure, and outgoing delivery queue now commit together, and accepted posts recover at runtime startup. This fixes the shared durability gap exposed by making summary delivery and closing one act; it applies to every thread, not only meetings.
