Status: done
Created: 2026-10-04
Updated: 2026-10-04

# Simplify branch search to a scalar-judge tool

## Intent

Branch search earns its keep only with a real, user-supplied judge (conclusion in `.ledger/202610041515-repository-history-replay/notes.md` section 2). Reduce it to that, with the simplest code paths and architecture, and park everything else at git tag `branch-search-v1` (annotated, at `837e5e5`). The tag exists only in the local clone until someone with push access runs `git push origin branch-search-v1`.

## Target behavior (approved 2026-10-04)

- `/branch-search <goal>` and the `search_branches` tool start a search. The user supplies a **judge**: one or more commands that each print a number on their last stdout line, each with a direction (lower or higher), plus optional pass/fail gate commands (for example the existing tests). Decision (operator, 2026-10-04): judges and gates come only with each search, as command or tool arguments; configuration holds no judges or gates. The `search_branches` tool takes `judges` (each a command and a direction) and optional `gates` (commands); the `/branch-search` command takes the same through flags after the goal.
- The model enumerates distinct approaches; attempts run in parallel as forks in isolated worktrees that share the parent's prompt cache (existing fork isolation).
- Every attempt is scored. Among attempts that pass every gate, the best judge number wins (judges in declared order, then smaller diff). The winner is applied when the workspace did not change during the search; otherwise the report gives the merge command.
- Optional `judge.profile`: a separate model compares the top attempts qualitatively when the user asks for it.
- One report message (or the tool result), one status line, cleanup of worktrees and refs.

## Remove

Model-authored scorer, validation and review, challengers and repair, phase separation, private git stores and ref restoration, passive activation and failure signatures, later generations and dynamic branching, keyed draws and replay tuning, the trap benchmark, fidelity tags, and every configuration key they need. `branch-search.example.json`, `docs/branch-search.md`, `docs/setup.md`, README, and the boundaries entry shrink to match.

## Move

The evaluation harness (`components/branch-search/eval/`: task extraction from ledger history, base-only clones, isolated real SDK sessions, launcher with cancellation, cost report) moves to its own internal component, not shipped, for history replay. Keep it working with its tests; drop the parts that only drove branch search arms.

## Acceptance criteria

- A search with a numeric judge on a fixture repository runs parallel attempts and applies the attempt with the best number among those that pass the gates; a test proves it with scripted replies.
- An attempt that fails a gate never wins, however good its number.
- With `judge.profile` set, the top attempts go to that model and its choice decides among them; without it, no judge request is sent.
- No code path, configuration key, or doc section of the removed features remains; `git grep` for their names finds only the history ledger and the tag.
- The moved evaluation harness keeps its offline tests green.
- Format, lint, typecheck, the full test suite, the loader test, and the package dry run pass.

## Current State

Done (2026-10-04).

## Outcome

Committed as one refactor on top of `9de3f40`. `components/branch-search/src` went from 4100 to 1304 lines and its tests from 9044 to about 1500. Operator decisions during the work: branch search is the model's tool only (`/branch-search` removed; the model writes judges, often from a measure the user suggests), and judges and gates come only as tool arguments. With the tool as the only entry, the apply hold and its tool block were removed as unreachable. The evaluation harness moved to `components/history-eval/` (not shipped); generic helpers (`runCommand`, git helpers, relative-path validation) moved to `components/shared/` so history-eval no longer imports branch search. Review fixes: oracle installation refuses symlinked destinations, `cloneIgnored` rejects `..` segments. Full suite on the final tree: 125 files, 1374 tests, pair 118/118, loader OK. Everything removed is at tag `branch-search-v1` (local only until pushed). Not verified: a search against a real model after the simplification.
