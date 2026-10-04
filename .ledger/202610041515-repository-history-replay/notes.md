# Notes: repository histories as replay worlds

Captured 2026-10-04 from the operator's discussion after the branch-search work. These notes keep the reasoning at full fidelity; `task.md` holds intent and state.

## 1. How we got here

Branch search (`.ledger/history/202610031403-branch-search/`) built parallel attempts in isolated worktrees, a hidden model-authored scorer, external random draws, later generations, replay of configuration grids (after Dream-RSI), challengers that attack the authored checks, and an evaluation harness. Evidence, in order:

An "arm" is one way of doing the task in a comparison: the agent alone, or a search. The "oracle" is a hidden test that decides whether a run solved the task.

- **Ledger-history pilot (1 task, Opus; report in `.ledger/history/202610031403-branch-search/evaluation/`):** no arm solved it; about $8; an hour. Unfair comparison (the single trajectory got a bare goal) and whole e2e files as oracles.
- **Slugify demo (gpt-6.1-sol):** search 12/12 vs alone 9/12 on a hidden oracle, about 6 minutes vs 1.5. But the authored checks missed ligatures, so no attempt died; the win was luck, not selection.
- **Trap benchmark (3 traps × 5 runs × 3 arms, gpt-6.1-sol, about $12; report in `.ledger/202610040726-branch-search-challenger-benchmark/evaluation/`):** alone 15/15, search 13/15, search with challengers 14/15. Win bar (+20 points) not met. Scorer kill rate on the known-wrong solutions was 100% in both search arms. Search cost about 5x the tokens and 3-4x the time. All search misses: two survivors passed the same incomplete checks and the smallest-diff tie-break picked the worse one.

## 2. Conclusions about branch search

- Search adds value only when a single run often fails **and** a reliable judge can tell attempts apart. The gain is bounded by (how much more often one of N succeeds) × (how often the judge picks it).
- **A model-authored scorer is the wrong judge.** It shares the attempts' blind spots: whatever case the model does not think of, neither checks nor attempts cover. Operator: "to have an LLM come up with the scorer, the judging criteria, then all this machinery behind it is 100% useless."
- Most of the complexity (author, validation, challengers, phase separation, private git stores, ref restoration) existed to manufacture and hide that judge.
- Hiding checks throws away information; a single agent shown good checks usually passes them (TDD).
- The AlphaGo analogy only holds with a perfect, cheap, external judge.
- **Where branching can still pay:** user-defined scalar judges — wall-clock time, memory, an external complexity measure (e.g. Radon), bundle size — and possibly a separate model judging quite different parallel implementations qualitatively. Also stuck debugging against a real reproduction.
- Smallest-diff as a tie-break prefers the less complete of two survivors when checks are incomplete.
- Process lesson: a cheap end-to-end demo should have come before nine tickets.

## 3. The reformulation (operator)

> To me Dream RSI is all about storing histories. For us, since we're not doing evaluations like you do in a training run, perhaps the closer analogy is the implementation and completion of a ledger task, along with the associated trajectory, which is the transcript.
>
> If you accumulate enough of those histories, the ledger tasks, along with the transcripts and any interesting scalar measures that could go with that (like the number of turns, things of that nature), then we have an opportunity to create an ever-expanding set of histories.
>
> And we can run simulations over those histories in order to optimize how the harness / AI is able to operate within the context of a specific repository.

The operator sees this as basically orthogonal to branch search, and a possible genuine breakthrough.

## 4. Mapping

| Dream-RSI | Here |
|---|---|
| One discovery run | One completed ledger task |
| Search tree | The task's transcripts (sessions, forks, subagents) |
| Stored execution outcomes | Start and end commits, tests added, and scalars: turns, tokens, cost, wall-clock, tool errors, repeated failure loops, user corrections |
| Pool of replay worlds | A growing, repository-specific set of these histories |
| Exploration policy | How the harness operates: system prompt, AGENTS.md guidance, skills, injected learnings, review and reflection cadence, compaction, passive triggers, tool guidance |
| No-regression selection | Adopt a harness change only if it does at least as well as the current one on the history set, then confirm on fresh tasks |

Outcomes here are real (the task closed, tests were added, the user accepted or corrected), so this depends far less on a model-made judge than branch search did.

## 5. What can be replayed

**Level 1, free offline replay.** Harness decisions that only react to recorded events. The transcript determines what they would have done:

- when a passive search would have fired (failure signatures are in the transcript);
- when compaction would trigger, given recorded context sizes;
- review and reflection cadence;
- which notebook learnings would have been injected.

This is pure Dream-RSI but narrow: once a policy changes what the model sees, the model's later turns would differ and the transcript cannot say how. This is the same "realized space only" limit Dream-RSI states.

**Level 2, paid re-simulation.** Anything that changes what the model sees (prompts, AGENTS.md text, skills, learnings). Each history becomes a realistic benchmark task: the base commit and goal as the start, the original work's tests as the judge, the original transcript's scalars as the bar. Re-simulation can also start from a checkpoint partway through a transcript, to re-run only the part a change affects. It costs tokens, but every case is real work from this repository with a known good outcome.

## 6. What is missing

- **Capture.** Ledger bundles do not reliably record which sessions worked on a task, or its start and end commits (branch-search ticket 09 hit wrong task boundaries because of this). Cheap first step: when a task starts and closes, record session IDs, HEAD commits, and a few scalars in the bundle automatically.
- **A target that cannot be gamed.** "Fewer turns" alone rewards doing less. Hold outcome quality fixed (tests pass, or the user accepted the work), then minimize turns, cost, corrections, or failure loops.
- **Variance and transfer.** Each history is one sample; a change that wins on past tasks must be confirmed on fresh ones.
- **Privacy.** Transcripts stay local; nothing goes into fixtures or the package.

## 7. Reusable pieces from branch search

The branch-search evaluation harness (`components/branch-search/eval/`) already: finds a ledger task's commits from cited hashes (with overrides), makes a base-only clone, extracts oracle tests that fail on the base and pass on the final commit, runs a configured agent in isolated SDK sessions (real auth, isolated state, shutdown before dispose, cancellation through a launcher), and writes a cost report. That is most of level 2's runner. Also reusable: `planStep`-style pure decision functions replayed over stored records (Dream-RSI's controller seam), and forks that share the parent's prompt cache.

## 8. Related work in this repository

- `.ledger/202610030109-context-ablation-experiment/`: measure a learning's value by removing it from a fresh agent's context on a known-answer task. An early instance of level 2.
- `.ledger/202610022036-notebook-learning-loop/`: in-session learnings and their distillation; candidate policy to optimize.

## 9. Open questions

1. Primary target: fewer turns to an accepted change, fewer user corrections, fewer failure loops, lower cost, or first-time adherence to repository conventions?
2. First policy to optimize: AGENTS.md and skill text, learning injection, review and reflection cadence, or something else? This decides level 1 or level 2.
3. Recover session links for the ~50 closed bundles from Pi's session logs, or capture from now on only?
4. How does this relate to the controller-evolution framing (evolving how effort is allocated)? Operator's second thread: two loops — the feature loop and a controller-improvement loop replaying completed histories; the decisive test is whether a selected policy does better on fresh work.
