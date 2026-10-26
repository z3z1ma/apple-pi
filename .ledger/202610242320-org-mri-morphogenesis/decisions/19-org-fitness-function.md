Type: interrogation
Status: resolved
Blocked by:

## Question

What is the organization's fitness function? The operator, 2026-10-24: "we need a really really strong fitness function for the org as a whole and for subsets of the org. The fitness function drives all of our tuning. We hill-climb against that fitness function. The function must be incredibly rich." Decide its terms, how each is computed from the database and the links, which subsets it is computed for, and how terms combine or stay apart.

This revises [What better means](04-what-better-means.md), which read section 2 of the brief as "no single score". The brief's own objective (minimise compute, delivery, operator attention, coordination, context reconstruction, and reorganization cost, weighted by lambdas, subject to hard constraints) is already a fitness function; the open part is making it concrete and rich.

A starting sketch to react to, not settled:

| Term (brief) | Computed from |
| --- | --- |
| Compute | model cost per finished task |
| Delivery | assignment to finish; time on `blocks` and `requires_decision` links |
| Operator attention | questions, escalations, mail to the operator, needs-you minutes |
| Coordination | messages, meetings, and handoffs per finished task; decision fan-in |
| Context reconstruction | reading before the first edit after a reopen or compaction; rereads of what a colleague already read |
| Reorganization | hires, moves, let-gos, and the cold-start cost of new people |
| Quality without verification | rework: `supersedes` links, tasks reopened or redone, reverted commits |

Subsets: the whole organization, a manager's subtree, the people on one task, one person, each over a time window.

Questions the interview must settle:

1. Comparison: one weighted number (easy to climb; needs weights) or a vector of terms where a change must not make any term worse (richer; often gives no answer).
2. Weights: set by the operator, or judged by managers.
3. Task size: cost per finished task punishes hard work. Compare the same subset before and after a change, or group tasks into classes?
4. Visibility: managers who see their own score may optimize the score instead of the work. Do they see it?

## Answer

Decided by the operator's thesis ([thesis.md](../thesis.md)), 2026-10-24. Fitness is one scalar, F(O; W, H): the organization O evaluated against its work W over a horizon H. Start from F = expected useful value minus expected total cost; terms are composable, may be weighted, transformed, and normalised, and their number is not fixed. The parameters are coherent defaults, not six weights the operator must pick. Coordination and context fragmentation are not separate penalties; their consequences already show in cost, delay, and quality, and the MRI explains them. Observed fitness and predicted fitness are two evaluations of the same objective. The global fitness is primary: local evaluation is the marginal change a mutation makes to global fitness, not a separate score per person, team, or subtree. Open remainders: [Realized or expected fitness](21-realized-or-expected-fitness.md) and [Source of useful value](22-source-of-useful-value.md).

The four interview questions above, as settled: (1) one scalar; (2) coherent default parameters, with value and cost of delay set per task by the assigner ([Source of useful value](22-source-of-useful-value.md)); (3) task size is handled by each task's own value, not cost per task; (4) managers see fitness, which follows from the thesis giving them the evaluate primitive; predictions checked against realized fitness are the guard against gaming it.
