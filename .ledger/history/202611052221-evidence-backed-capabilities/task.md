Status: done
Created: 2026-11-05
Updated: 2026-11-05

# Turn recurring lessons into tested rules and programs

## Intent

The organization notices the same lessons and failures again and again, but it writes them down as prose and makes the same mistake later (the "never batch an edit with the check that depends on it" lesson is recorded at least five times and recurred on 2026-11-05). Give it a loop that turns recurring experience into executable capability (repository rules, harness guards and saved programs), proves each candidate with evidence rather than a claim, lets a challenger try to break it, and adopts it only through the operator's sign-off. Retire capabilities that stop earning their place.

The operator asked for both mutation types to be scoped: rules and guards, and saved programs. The proposal is `proposal.md`; the build order is `tickets/`.

## Acceptance

- Running the loop on this machine, unprompted, surfaces the batching lesson (or another real recurring defect) with links to its recorded occurrences, and brings a candidate rule or guard with replay evidence and a challenger's report to sign-off.
- A candidate rule's evidence is a replay over recorded actions since the last change to the surface it guards: the past mistakes it would have caught and the good actions it would have refused, each linked to its transcript entry.
- A candidate program's evidence is paired runs on the same tasks with and without it, at least three samples per arm, reporting correctness first, then tool calls, tokens, cost and time.
- Nothing is adopted without the operator's sign-off, and every adopted capability carries the evidence it was adopted on.
- A periodic report proposes retiring rules that never fired and programs that were never called since adoption.

## Current State

Closed; see Outcome.

History:

Approved by sign-off on 2026-11-05; the operator's decisions are in `proposal.md`.

- Done: ticket 01 (`session_evidence`), 02 (`replay_rule`), 04 (`compare_program`, peers in worktrees with `--approve`).
- Built, awaiting their acceptance runs: 03 (role `capability-steward`, prompt `/find-improvements`), 05 and 06 (the program and retirement steps of the same role).
- Formal models: `specs/capability-candidate.tla` (design of the steward protocol), `specs/program-comparison.tla` (comparison cleanup, as built), `specs/program-comparison.lean` (balanced arms, replay counting); each TLA model has a control that fails.
- The runtime change for ticket 04 is live only after a runtime restart.

## Outcome

Done 2026-11-06. All six tickets are closed.

- Tools: `session_evidence`, `replay_rule`, `compare_program` (with program peers in caller-named worktrees, launched with `--approve`).
- The steward: the `capability-steward` role and `/find-improvements`.
- First adopted capability: the dependent parallel batch guard, approved by the operator and merged as `9947ed34`; its bundle is `.ledger/history/202611052330-dependent-edit-batches/`.
- Formal models with failing controls: `specs/capability-candidate.tla`, `specs/program-comparison.tla`, `specs/program-comparison.lean`.
- Reviews: two rounds on the harness code (20 and 16 confirmed findings, all addressed, one rejected with reasons), one on the guard (11, all fixed).
- Not established: a program comparison against a real model, and whether the steward's proposals pay for themselves over time.
