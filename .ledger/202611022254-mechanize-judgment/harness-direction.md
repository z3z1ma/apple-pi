# Harness capability or repo convention

The operator's correction (2026-11-03): most of the thread is about what a coding harness should do in any repository,
not about developing apple-pi. I had built nearly everything as apple-pi repo machinery. The reclassification:

| Idea | Where it belongs | What I built | Change |
|---|---|---|---|
| No comments; rationale goes out of band | **Harness**, opt-in per repo | An apple-pi script (`lint/no-comments.mjs`) and a repo-wide migration | Enforce at edit/write time in any repo that opts in; apple-pi opts in |
| Every issue becomes a rule, written by agents | **Harness**, opt-in per repo | GritQL rules in apple-pi's `biome.json`; apple-pi-specific action rules | Run a repo's `.pi/rules/*.grit` on every edit; agents write rules there |
| Formal models of state machines | **Harness**: skill, bundled TLC, spec-first gate, research track | Packaged skill, TLC runner, command-journal spec (6cdcb032) | Expose model checking as a harness capability; the spec-first gate is opt-in |
| File suffixes declaring where code runs | apple-pi convention | Rahul's lane | No change |
| Build budgets | apple-pi | Fiona's lane | No change |

## The harness design

A repository opts in by having `.pi/rules/` (operator decision):

- `.pi/rules/*.grit`: Biome GritQL rules.
  - The harness checks every `edit` and `write` before it lands. It computes the file's content after the change and
    runs the rules on it. A violation blocks the change and says why, so the agent fixes it in the same turn.
  - Repository lint (`npm run lint`) reads the same rules.
- `.pi/rules/policy.json`:
  - `"comments": "forbid"` blocks a change that adds a comment to source. The message says to move the rationale to
    `.context/<path>.md`, a better name, or a test. Tool directives are exempt.
  - Rule scopes and paths are listed here too.
- **Rules written by agents.** Review, distill and the pair turn detectable lessons into a new rule file, with a fixture
  that shows it firing. The harness records each rule's firings, so a rule that never fires can be retired and one that
  blocks good code can be narrowed. This is the self-improvement loop: each defect class, once caught, cannot recur in
  that repository, and no agent has to remember it.
- **Agent-action rules** (commands, tool-call patterns) live in the same directory as data, not code. apple-pi's
  current list moves there as its first ruleset.

## Formal methods: where the leverage is across repositories

The goal: a harness that raises code quality and lowers defects in any codebase it works in. Formal methods matter
here because they give an agent an oracle for its own work that is stronger than tests it writes itself.

1. **Spec-first gate (opt-in).**
   - `policy.json` marks stateful paths (protocols, lifecycles, reconcilers, money and permission logic) and names
     their spec.
   - An edit to a marked path is accepted only when the spec exists, TLC passes, and the spec changed with the code
     when the code's behavior changed.
   - Reviewers review the spec diff: it is far smaller than the code diff, and it is what the code must obey.
2. **Counterexample-to-test loop: the research bet.** In any repository, with no prior specs:
   1. An agent writes a model of a stateful area from its code and its `.context` invariants.
   2. TLC searches it.
   3. Each counterexample trace becomes an executable test against the real code.
   4. When the test fails, a real bug is found, with a reproduction. When it passes, the model was wrong, and the agent
      refines it from the evidence and repeats.

   This is counterexample-guided refinement with the language model as both modeller and test writer. The
   implementation, not the model, is the judge. Every reported bug carries a failing test, so false positives cannot
   pass as findings. Measured across many repositories, it is a publishable result: bugs found per hour against
   reviewers and fuzzers, with reproductions.
3. **Context invariants become checkable.** `.context` files already state invariants in prose ("no command applied
   twice", "receipts are monotone"). Like lessons becoming lint rules, an invariant becomes a TLA+ property, a runtime
   assertion in tests, or a property-based test.
4. **The cheapest sufficient formalism.** The skill chooses:
   - TLA+ for concurrency, protocols and crash recovery;
   - Alloy for data shapes and permission models;
   - property-based state-machine tests for single-process logic.

   This keeps the capability usable in an ordinary product repository, not only in distributed systems.

Not pursued (operator): trace validation of the harness runtime, and verified-by-construction programs.

## Build order

1. Harness rules engine: `.pi/rules`, block on edit, comment policy, firing counts. Move apple-pi's rules and comment
   check into it.
2. Model-check capability: the TLC runner shipped with the package, plus the spec-first gate in `policy.json`.
3. Research track: the counterexample-to-test loop, first on apple-pi's own lifecycles, then on outside repositories.
