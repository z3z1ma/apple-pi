Status: done
Created: 2026-10-04
Updated: 2026-10-04

# Branch search: adversarial scorer and trap benchmark

## Intent

The slugify demo (2026-10-04; a throwaway repository, not kept: `slugify` keeps every script, and the goal is to turn Latin letters with diacritics into ASCII) showed that the search works live in about 6 minutes, but its authored checks missed ligatures (`æ`, `ß`, `œ`). No attempt died, and the search beat the agent alone by luck. The checks are the weak link. This task makes the checks adversarial and measures, on fast staged traps, whether search beats one trajectory.

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

Tickets 01-04 done. First benchmark (2026-10-04, `evaluation/trap-benchmark-20261004-171429.md`, operator chose the `balanced` profile, openai/gpt-6.1-sol, medium): 45 of 45 runs, about $12 estimated, 91 minutes.

- Solved: alone 15 of 15, search 13 of 15, search+challengers 14 of 15. Win bar not met (-7 points against +20).
- Scorer kill rate on the known-wrong solutions: 100% in both search arms.
- Cost: search arms about 5x the tokens and 3-4x the wall-clock of the agent alone.
- All search misses were on slugify: two survivors passed the authored checks with nearly equal diffs, and the smaller one missed hidden cases; one search had no survivor.
- Reading: the goals state every requirement the oracle checks, so a careful single agent solved everything; the benchmark had no headroom for search to show a gain. The smallest-diff tie-break can prefer the less complete of two survivors when the checks miss a case.

- 01 `fbe4e45` (+ `586b270`): challenger pass. Decisions in review: an open gap after the repair rounds ends `aborted: scorer invalid`; the author may dismiss a claimed defect with a recorded reason; author and challenger forks write git objects to a private store; scorer-phase refs are restored except changes whose objects the shared store holds (user work). A ref deleted during the phase is recreated. Documented residuals: a fork that deliberately bypasses the private store; a user stash pushed on top of a challenger stash in the same phase leaves the challenger's entry.
- 02 `ecebfa0` (+ `edf6af1`): traps slugify-diacritics (input coverage), config-deep-merge (regression), tags-case-dedupe (performance).
- 03 `7137f2c`: `npm run eval:traps` with `BRANCH_SEARCH_TRAPS_CONFIG` and `BRANCH_SEARCH_TRAPS_OUT`; example `components/branch-search/eval/traps.example.json`. A shared launcher (`scripts/eval-run.mjs`) owns cancellation for both evaluation commands.
- Cost: the builder estimates about 1,800 requests for 45 runs, roughly $40-150 on an Opus-class profile, well above the planned $10-20.

## Outcome

Win bar not met; the agent alone solved every trap. Conclusion with the operator (2026-10-04): a model-authored scorer shares the attempts' blind spots, so the authored-scorer path adds cost without value; branching stays only for user-defined scalar judges. Branch search is to be simplified, and the follow-up idea moved to `.ledger/202610041515-repository-history-replay/` (see its `notes.md`).
