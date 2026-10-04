Status: ready
Created: 2026-10-04
Updated: 2026-10-04

# Branch search: adversarial scorer and trap benchmark

## Intent

The slugify demo (2026-10-04, `/tmp/bs-demo`) showed that the search works live in about 6 minutes, but its authored checks missed ligatures (`æ`, `ß`, `œ`). No attempt died, and the search beat the agent alone by luck. The checks are the weak link. This task makes the checks adversarial and measures, on fast staged traps, whether search beats one trajectory.

Prior work: `.ledger/history/202610031403-branch-search/` (spec, tickets, pilot evaluation). Product behavior: `docs/branch-search.md`.

## Approach (draft)

1. **Challenger pass.** After the authored scorer validates, one or more challenger forks each write a plausible but wrong implementation of the goal in a base worktree, and name the defect they planted. Challengers never see the checks. The harness runs the gates on each challenger implementation. A challenger that passes every gate exposes a gap: the author gets the challenger's diff and defect claim, adds a check, and validation must then show the new check fails on the base and on that challenger implementation. Challenger content never reaches branches (phase separation, spec 8.4). The record keeps each challenger's diff, claim, and whether the gates caught it. The number of challengers is a configuration key with no built-in value.
2. **Trap benchmark.** 3 to 5 staged traps checked into the repo: each a tiny repository, a goal, and an oracle test that runs in seconds. In each, the obvious fix passes the visible tests but fails a hidden case. Arms: agent alone (framed like a branch directive), search, and search with challengers. Each arm runs N times per trap, in parallel. The report gives per trap and arm the solve rate, median time, and cost, plus how often the authored checks killed a known-wrong reference implementation stored with the trap.

## Acceptance criteria (draft)

- With challengers configured, a challenger implementation that passes every gate makes the author add a check, and the frozen scorer fails on that implementation. A test proves it with scripted replies.
- No challenger diff, claim, or check content appears in any branch prompt or on disk while a branch runs.
- Each trap's known-wrong reference implementation fails its oracle and passes its visible tests; its correct reference passes both.
- The benchmark command runs all arms N times per trap and writes one report with solve rate, median time, cost, and the scorer-kill rate per arm.
- The first benchmark report exists in this bundle.

## Decisions (operator, 2026-10-04)

- First benchmark: 3 traps, 5 runs per arm (45 runs; roughly $10-20).
- 2 challenger forks per search; `branch-search.example.json` gets the same value.
- Win bar, fixed before the run: search with challengers solves at least 20 percentage points more trap runs than the agent alone, over all traps.

## Current State

Shaped. Next: break into tickets (challenger pass; traps and their reference implementations; benchmark runner and report; first run).

## Outcome

Pending.
