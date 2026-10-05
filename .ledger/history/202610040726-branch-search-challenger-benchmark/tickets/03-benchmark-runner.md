# 03: Benchmark runner and report

**What to build:** One command runs the trap benchmark: for each puzzle, each arm runs N times in parallel, each run in a fresh copy of the puzzle. The arms are the agent alone (prompted to work until done, like an attempt directive), search, and search with challengers. Every final state is scored with the puzzle's oracle. Separately, each search's frozen checks are run against the puzzle's known-wrong solution to measure whether they kill it. The command writes one report: per puzzle and arm the solve rate, median time, and cost; the scorer kill rate per search arm; overall solve rates; and whether the win bar holds (search with challengers solves at least 20 percentage points more runs than the agent alone over all puzzles). Run count, model, and search configuration come from an operator-supplied file; nothing is built in.

**Blocked by:** 01 (Challenger pass), 02 (Three trap puzzles with reference solutions).

**Status:** ready-for-agent

- [ ] With the fake model and scripted replies, the command runs all three arms N times on each puzzle in fresh copies and scores every final state with that puzzle's oracle.
- [ ] The report lists per puzzle and arm the solve rate, median time, and cost, the scorer kill rate on the known-wrong solution for each search arm, and the win-bar verdict computed from the overall solve rates.
- [ ] A missing configuration file or key prints what to fix and starts no model request.
- [ ] Cancelling the command stops running arms, removes their copies, and writes the report of what finished.
- [ ] The command never runs in the default test suite, and nothing it adds ships in the package.
