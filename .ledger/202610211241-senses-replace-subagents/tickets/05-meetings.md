# 05: Meetings

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** A manager calls `meet(people, agenda)` to open a meeting thread whose participants are all pushed. Everyone answers in the thread until the organizer calls `end_meeting(thread, summary)`, which sends the summary to everyone and closes the thread. There is no cap on rounds.

**Blocked by:** 01 Mail is threads

**Status:** ready-for-agent

- [ ] `meet` delivers the agenda to every invited person as a turn, and each reply reaches every other participant.
- [ ] `end_meeting` delivers the summary to every participant and further replies to that thread are refused.
- [ ] Only the organizer can end the meeting.
