# 13: Spend on dropped work

Part of the approved spec [../spec.md](../spec.md); its Terms table defines obligation, completion, window, horizon, scenario, impact, and the other words used here.

**What to build:** The `org_fitness` result shows spend on dropped work: the compute and delay already counted, attributed to tasks that were later cancelled or superseded. It is a fact, not a verdict: a skeptic's investigation that caused a cancellation may have been the best work done. Compute per task is attributed from each person's focus history (which task they had in focus when they spent it), and the result marks this attribution as an estimate. It explains the number; it is not an extra charge. Managers judge whether dropping the work was worth what it cost.

**Blocked by:** 11 (Fitness as one tool among the others).

**Status:** ready-for-agent

- [ ] Against a temporary state database, $12 spent by a person while a task was in focus, before that task was closed `cancelled`, appears as $12 of spend on dropped work on that task, marked as an estimate; the realized total is unchanged by showing it.
- [ ] Compute and delay on a task named by a `supersedes` link appear as spend on dropped work; the same task without the link shows none.
- [ ] Compute spent with no task in focus is reported as unattributed, not as dropped work.
