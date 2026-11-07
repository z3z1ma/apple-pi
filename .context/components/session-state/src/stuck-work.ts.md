## file

The operator chose the policy (2026-11-07): stuck means unheld for 15 minutes or held and silent for 4 hours; the digest goes to the organization's coordinator, else its root; open ephemeral tasks plus ledger tasks in ready or in-progress are watched (planning is parked on purpose); a snooze lasts for a duration and ends early on any update. The thresholds are constants, not settings, until a real need to vary them appears.

A task's last update is the latest of its opening, its task.md mtime, its task-thread's last message, any assignment start or end and any focus span edge. The digest and check-ins post on their own threads, so they never count as updates; a coordinator answering in the task thread does. Re-notification uses the later of the last update and the last notice (`task_notices`), so an unchanged task is mailed once per period, not every sweep. A snooze is ignored once the task changes after it was set.

Ledger tasks the runtime has never registered are found in the live `.ledger` above each organization root's working directory and keyed by their bundle path; registered tasks are keyed by id. A bundle registered to one organization is never reported again through another root's directory.
Why: the operator asked for the harness to drive work to zero; friction notices deliberately infer no age, so idleness needed its own, explicit mechanism.
Coupled: components/session-state/src/runtime.ts, components/session-state/src/schedules.ts, components/session-state/src/work-tools.ts, roles/coordinator.md
Verify: components/session-state/tests/stuck-work.test.ts
