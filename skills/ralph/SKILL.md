---
name: ralph
description: "Run or continue bounded fresh-context Ralph iterations over a goal or prepared ledger task."
disable-model-invocation: true
---

# Ralph

Ralph is a bounded loop of fresh implementation engineers. Each iteration starts a new `implementation-engineer` with an empty context, which reads the repository, makes one coherent increment, checks it, and leaves. The repository is the only memory between iterations; you set the goal, bound the run, and own review and integration.

## Why temporary peers here

Other processes staff work with standing people: lasting colleagues who keep what they learn across jobs (see [`handbook-writing`](../handbook-writing/SKILL.md)). Ralph is the named exception: its value is a fresh context every iteration, which a standing person cannot give, and the loop's bounds, mutation scoring, and stop conditions are code that prose cannot run reliably. So Ralph runs as a `pi_exec` program whose iterations are temporary peers (`agent_run`); each is discarded before the next starts, leaving no growing roster.

## Choose a program

- [`ralph-simple.py`](references/ralph-simple.py) runs bounded increments over a goal you own, with no ledger.
- [`ralph-ledger.py`](references/ralph-ledger.py) runs bounded increments over a prepared ledger task, and stops when the task becomes `done` or `blocked`.

Adapt the matching increment prompt, [`simple-increment.md`](references/simple-increment.md) or [`ledger-increment.md`](references/ledger-increment.md), with the goal's terms, acceptance criteria, relevant paths, constraints, likely failure modes, and fastest checks, then inline it in the program before calling `pi_exec`. Pass `goal`, `iterations`, and `stack` (context paths), plus `task` for the ledger program; the programs document their inputs and their result.

Make the goal concrete enough that a fresh engineer can choose a useful increment without inventing product decisions; an engineer that needs an operator decision stops and names it. A low-mutation stop is an escape hatch, not a judgment that the goal is complete.

## Iteration contract

Each engineer reads the current repository, picks the single most valuable increment, implements it, runs the relevant checks, and stops. Engineers never commit, push, merge, deploy, publish, reset, or review.

## After a batch

1. Inspect the repository and run the relevant checks yourself; fix ordinary problems in your own session.
2. Read and apply [`code-review`](../code-review/SKILL.md) to the batch's changes.
3. Read and apply [`operator-sign-off`](../operator-sign-off/SKILL.md) for a code sign-off, unless the operator waived sign-off for this run (as for unattended overnight loops); say so in the report.
4. Decide whether another batch is useful. Commit, and close a ledger task, only with the operator's authority.

Record progress or evidence in the ledger only when a later session needs it.
