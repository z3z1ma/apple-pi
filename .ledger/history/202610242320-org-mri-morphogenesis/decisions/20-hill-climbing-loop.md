Type: interrogation
Status: resolved
Blocked by: 19

## Question

How does the organization hill-climb against the fitness function? Decide who makes a move (the manager in its sweep), what a move is (any change made with the existing manager tools, stated in a message), how the fitness before and after a move is compared and over which window, when a move is kept or undone, how noise is told apart from a real change, and where the history of moves and their fitness deltas lives. No org patch object (operator, 2026-10-24).

## Answer

Decided by the operator's thesis ([thesis.md](../thesis.md)), 2026-10-24. The substrate gives four primitives (observe, evaluate, mutate, compare) and does not prescribe the search. A manager searches over legal mutations (short compositions of existing manager operations), estimates the change in fitness over a horizon so investments that cost now can win, executes, measures, and improves its estimates. Greedy, exploratory, or stable strategies are all allowed. No cheapest-first rule, no hysteresis thresholds, no approval workflow, no reorganization schema; runtime permissions and role boundaries stay. Open remainder: [Record of mutations and outcomes](23-record-of-mutations-and-outcomes.md).
