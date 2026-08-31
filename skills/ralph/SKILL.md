---
name: ralph
description: "Use only when the operator explicitly asks to run or continue bounded fresh-context Ralph iterations over a goal or prepared ledger task."
---

# Ralph

Ralph is a caller-controlled outer loop around fresh coding workers. The repository carries implementation state between iterations; the caller supplies the goal, bounds the run, interprets the result, and retains review and integration authority.

Ralph can operate with or without ledger. Use the smallest program matching the goal's real state owner rather than inventing a task solely to run the loop.

## Choose a program

- [`references/ralph-simple.js`](references/ralph-simple.js) runs bounded fresh increments over any caller-owned goal. It has no ledger dependency.
- [`references/ralph-ledger.js`](references/ralph-ledger.js) runs bounded increments over a prepared ledger task and stops when that task becomes `done` or `blocked`.
- [`references/ralph-ledger-review.js`](references/ralph-ledger-review.js) is an advanced, explicitly opt-in ledger composition that couples each increment to an inlined Review spine.

Adapt [`references/simple-increment.md`](references/simple-increment.md) for the general program or [`references/ledger-increment.md`](references/ledger-increment.md) for either ledger program. Inline the adapted prompt in the chosen JavaScript body before calling `pi_exec`; do not dynamically load these prompts with `skills.body`.

## Shared inputs and outputs

Every program requires:

- `goal`: a non-empty caller-owned outcome.
- `iterations`: a canonical positive safe-integer string chosen by the caller.
- `stack`: newline-separated repository context paths. It is optional for `ralph-simple.js` and required for the ledger programs.

The ledger programs additionally require:

- `task`: the prepared `.ledger/<id>/task.md` whose status governs terminal task stops. The controller adds it to every worker's context stack.

The simple and default ledger programs return:

```javascript
{
  status: "completed" | "failed" | "stopped",
  stopReason?: "task-done" | "task-blocked" | "low-mutation",
  requestedIterations: number,
  completedIterations: number,
  failedAt?: number,
  lowMutationStreak?: number,
  lastMutationScore?: number,
  failures: [{ iteration: number, error: string }],
}
```

`completedIterations` counts only workers that returned successfully. `failedAt` identifies the first failed worker. Low-mutation stopping is an adaptable escape hatch, not a completion judgment. ledger task stops report the task status they observed; they do not independently prove that status is correct.

## Worker contract

Each iteration starts only after the previous one settles:

- **Role:** an untyped fresh worker using the adapted `RALPH` system prompt; do not select a catalog agent type.
- **Profile:** `coding`.
- **Tools:** `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write`.
- **Context:** only the caller-supplied stack and, for reviewed runs, bounded review feedback.

Workers inspect current repository state, choose one coherent increment, implement it, run relevant checks, and stop. They never commit, push, merge, deploy, publish, reset, or decide final integration.

## General bounded loop

Use `ralph-simple.js` when the user wants repeated fresh iterations over a bounded goal but no ledger task is the authoritative state owner.

```javascript
{
  code: "<adapted references/ralph-simple.js>",
  display: {
    name: "Ralph loop",
    description: "Run bounded fresh implementation increments.",
  },
  inputs: {
    goal: "Improve the selected implementation until the requested behavior is satisfied.",
    stack: "README.md\nsrc/feature.ts\ntests/feature.test.ts",
    iterations: "4",
  },
}
```

The repository is the shared memory. The caller must make the goal concrete enough that a fresh worker can choose a useful increment without inventing product semantics. When the next step needs an operator decision, the worker stops and reports it.

## ledger loop

Use `ralph-ledger.js` when a prepared ledger task owns intent and acceptance, an active plan owns unfinished increments and blocking state, and `evidence/` owns observations.

```javascript
{
  code: "<adapted references/ralph-ledger.js>",
  display: {
    name: "ledger Ralph loop",
    description: "Run bounded fresh increments over a prepared task.",
  },
  inputs: {
    goal: "Implement the prepared task. Choose the most important unfinished increment.",
    task: ".ledger/<task-id>/task.md",
    stack: ".ledger/INDEX.md\n.ledger/<task-id>/plans/implementation.md",
    iterations: "4",
  },
}
```

Adapt `ledger-increment.md` with the task terminology, acceptance criteria, relevant paths, implementation constraints, likely failure modes, and fastest relevant checks. Preserve its one-increment boundary, ledger-memory contract, ordinary-tool boundary, no-commit rule, and no-review rule.

## Caller ownership

Default Ralph supplies bounded fresh-context implementation increments. After a batch, the caller inspects the repository state, runs the relevant checks, handles ordinary fixes in the root session, and decides whether another batch is useful. ledger progress or evidence is persisted only when it has continuity value for a later session.

Caller validation is the default. An active plan may explicitly add `Review: one-pass — <risk>` for one complete review after the coherent change or `Review: staged — <risk>` for a named high-cost risk. Nits conclude in the root session.

`ralph-ledger-review.js` remains an explicitly opt-in advanced composition for an operator who specifically requests increment-then-review coupling. Ordinary Ralph and ledger execution use `implementation-planning`, `plan-execution`, and `task-closure` only when those phases are actually needed. `ledger_add` creates tasks and `ledger_close` archives them.
