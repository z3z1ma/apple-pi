# 13: Agent World shows the workplace

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** The backend projects threads, escalations, assignments, the backlog, and ephemeral tasks; the world draws them: a letter flies between characters for mail; a meeting gathers its participants in a meeting room in the headquarters; each team room has a notice board for its channel; an escalation to the operator walks to his desk; ledger tasks and the backlog hang on a task board in the headquarters (the quest office stays Jira's); ephemeral tasks are notes in team rooms; each character carries its focused quest; and the operator assigns work by handing a quest to a character. Theme words come from each theme pack.

**Blocked by:** 03 Team channels, 04 Escalation and the operator as a person, 05 Meetings, 07 Hiring is assigning; inferred binding goes

**Status:** in-progress

- [x] The backend test shows threads, meetings, escalations, assignments, backlog, and ephemeral tasks from a real runtime.
- [x] In headless Chrome, a mail between two characters shows a letter, a meeting places its participants in the meeting room, and a team room's notice board lists its channel's posts.
- [x] The headquarters task board lists live ledger tasks and the backlog; the quest office lists only Jira issues.
- [x] Handing a quest to a character assigns that task to its session in the runtime.
- [x] Each theme pack names every new object.
