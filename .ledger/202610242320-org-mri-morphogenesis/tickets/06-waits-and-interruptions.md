# 06: Delay by state, open waits, and operator interruptions

Part of the approved spec [../spec.md](../spec.md); its Terms table defines obligation, completion, window, horizon, and the other words used here.

**What to build:** The `fitness` result splits each task's delay by state: queued (unassigned and no open wait), waiting (an open `blocks` or `requires_decision` link), and in progress (assigned, no open wait), so it tells work that needs people from work that needs a decision. It also shows the open waits (`blocks` and `requires_decision` links not yet resolved) with how long each has lasted; the interruption count in the window: questions members opened to the operator, plus messages members sent in mail threads the operator takes part in (an escalation is such a thread and counts once per message, never twice); and the operator-attention term as unmeasured: priced at $1 per minute in the model but shown as unknown and left out of the number. Delay stays charged once per task, however many waits explain it.

**Blocked by:** 02 (Record and resolve links between work), 04 (One evaluator and realized fitness from work).

**Status:** ready-for-agent

- [ ] A task that sits unassigned for an hour, then waits an hour on an open link, then is worked for an hour shows one hour each of queued, waiting, and in-progress delay, summing to its delay.
- [ ] A task with three open `blocks` links shows three open waits with their ages, and resolving one removes it from the list.
- [ ] In one window, two questions opened by members, one escalation, and one ordinary mail from a member to the operator give an interruption count of 4; a message the operator sent, a message from a non-member, and ones outside the window do not count.
- [ ] The result names the attention term as unmeasured; adding interruptions or waits does not change the total.
