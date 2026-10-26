# 13: Spend on dropped work

Part of the approved spec [../spec.md](../spec.md); its Terms table defines obligation, completion, window, horizon, scenario, impact, and the other words used here.

**What to build:** The `org_fitness` result shows spend on dropped work: the compute and delay already counted, attributed to tasks that were later cancelled or superseded. It is a fact, not a verdict: a skeptic's investigation that caused a cancellation may have been the best work done. Compute per task is attributed from each person's focus history (which task they had in focus when they spent it), and the result marks this attribution as an estimate. It explains the number; it is not an extra charge. Managers judge whether dropping the work was worth what it cost.

**Blocked by:** 11 (Fitness as one tool among the others).

**Status:** done (0443d9fd)

The delivered breakdown explains existing spend; it adds no event or charge. Compute means recorded inference expenditure, while delay is the already-evaluated cost from a task's asserted hourly rate. Focus is the one task a person selected, not every assignment they hold. Attribution uses each retained successful work-change record and its atomically posted task-thread message (`<command_id>:post`), not today's focus. Unknown/no focus, another organization's task or an excluded temporary-only internal task remains unattributed.

Current cancellation/replacement may be recorded after the requested spend window; that changes the explanation, not its dollar total. Timestamp ties and incomplete history are disclosed in the [implementation notes](../dropped-work-implementation-notes.md). Independent checks passed 48/48 focused tests, loader, Node/web typecheck, Biome and context lint (157 files); the operator approved 28/28 hunks. No full-suite or live-rollout claim. This ticket is complete; continue with [ticket 14](14-scenarios-and-predictions.md).

- [x] Against a temporary state database, $12 spent by a person while a task was in focus, before that task was closed `cancelled`, appears as $12 of spend on dropped work on that task, marked as an estimate; the realized total is unchanged by showing it.
- [x] Compute and delay on a task named by a `supersedes` link appear as spend on dropped work; the same task without the link shows none.
- [x] Compute spent with no task in focus is reported as unattributed, not as dropped work.
