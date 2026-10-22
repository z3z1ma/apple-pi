# 06: Tasks are assigned

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** The runtime records assignments (person, task, assigned by, when, ended when) and each person's focused task. A task is a ledger bundle or an ephemeral task bundle under the state directory, with the same shape (`task.md` goal, room for context, `retrospective.md`). Tools: `take_task(goal or task)`, `assign(person, task or goal)` and `unassign` (managers), `focus(task)`, `finish_task(outcome)`, `promote_task(task)`. Assigning wakes a sleeping person. On assignment, on focus, and after each compaction, the focused task's `task.md` is appended to the person's context. Each task has a thread with its assignees and assigner; `finish_task` writes the outcome into `task.md`, ends the assignment, posts there, and archives an ephemeral task with its retrospective.

**Blocked by:** 01 Mail is threads, 02 The directory and human-named manager tools

**Status:** ready-for-agent

- [ ] `take_task("goal")` creates an ephemeral bundle in the state directory with that goal in `task.md`, assigns it, and focuses it; the goal arrives in the session's context as one appended message.
- [ ] `assign` by a manager to a sleeping report wakes it with the goal; `unassign` ends the assignment and the person is told.
- [ ] After a compaction, the focused task's `task.md` is appended again.
- [ ] `finish_task` writes the outcome, ends the assignment, and the assigner receives it in the task's thread; a finished ephemeral task is archived with its retrospective.
- [ ] `promote_task` moves an ephemeral bundle into the project's `.ledger/` with an index row, and the assignment follows it.
- [ ] Editing `task.md` and refocusing delivers the edited goal.
