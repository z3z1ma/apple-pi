# 07: Hiring is assigning; inferred binding goes

**Context:** [spec.md](../spec.md) defines the terms used here (person, operator, runtime, thread, push and pull, ephemeral task, intern) and records the decisions this ticket implements.

**What to build:** `hire(role, name?, goal)` and `rehire(person, goal?)` create the task from the goal and assign it. A session the operator started is told to take its first request as a task before working. The bridge no longer binds a ledger touch to the session (`history.json` still records touches), and session-title's quick-model intent is deleted. The directory shows each person's tasks, focus, track record (assignments finished), and "available" when it holds none; unassigned live ledger tasks are the backlog. The sidebar and dashboard title each card by its focused task.

**Blocked by:** 06 Tasks are assigned

**Status:** done

- [x] A hire's first turn carries its goal as its focused task; a hire without a goal is refused.
- [x] Editing a ledger file no longer changes any session's work in the runtime, and no intent request is made after a turn.
- [x] `directory` shows tasks, focus, track record, and "available"; a manager sees the backlog of unassigned live ledger tasks.
- [x] The sidebar and dashboard titles show the focused task's title (pytest against a migrated database).

## Evidence

- Session-state, organization, session-title, and ledger tests: 35 files / 164 tests passed. Hire tests inspect the goal already on disk when the new process starts; rehire covers retaining work and taking a new goal. Naming tests prove one user turn makes only its own model request.
- World backend, inn, and recruit checks passed over the real runtime and isolated tmux. Browser/build checks: 42 passed across targeted runs; one stale record-label assertion was corrected and its 11-test suite passed again. World dist rebuilt.
- Sidebar/dashboard: 29 tests passed; the added focused-title/human-reply-name check passed separately. Swift feed: four checks passed, including an older database with no work tables.
- Final work checks: five passed, including archive path continuity and an unassignment returning work to the backlog without adding an accomplishment.
- Typecheck, repository format check, lint (one existing notch-test warning), loader, context lint (114 files), and diff check passed.

## Deviations

The new source of work also replaces old guesses in Agent World and the notch, not only the terminal views. Ledger archival explicitly tells the runtime the new registered bundle path; it changes neither assignment nor focus. Existing database columns for inferred work remain historical and unused. No live sessions or runtime were restarted.
