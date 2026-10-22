# 07: Hiring is assigning; inferred binding goes

**What to build:** `hire(role, name?, goal)` and `rehire(person, goal?)` create the task from the goal and assign it. A session the operator started is told to take its first request as a task before working. The bridge no longer binds a ledger touch to the session (`history.json` still records touches), and session-title's quick-model intent is deleted. The directory shows each person's tasks, focus, track record (assignments finished), and "available" when it holds none; unassigned live ledger tasks are the backlog. The sidebar and dashboard title each card by its focused task.

**Blocked by:** 06 Tasks are assigned

**Status:** ready-for-agent

- [ ] A hire's first turn carries its goal as its focused task; a hire without a goal is refused.
- [ ] Editing a ledger file no longer changes any session's work in the runtime, and no intent request is made after a turn.
- [ ] `directory` shows tasks, focus, track record, and "available"; a manager sees the backlog of unassigned live ledger tasks.
- [ ] The sidebar and dashboard titles show the focused task's title (pytest against a migrated database).
