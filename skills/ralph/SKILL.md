---
name: ralph
description: "Use only when the operator explicitly asks to run or continue bounded fresh-context Ralph iterations over a goal or prepared Ledger task."
---

# Ralph

Ralph is a caller-controlled outer loop around fresh coding workers. The repository carries implementation state between iterations; the caller supplies the goal, bounds the run, interprets the result, and retains review and integration authority.

Ralph can operate with or without Ledger. Use the smallest program matching the goal's real state owner rather than inventing a task solely to run the loop.

## Choose a program

- [`references/ralph-simple.js`](references/ralph-simple.js) runs bounded fresh increments over any caller-owned goal. It has no Ledger dependency.
- [`references/ralph-ledger.js`](references/ralph-ledger.js) runs bounded increments over a prepared Ledger task and stops when that task becomes `done` or `blocked`.
- [`references/ralph-ledger-review.js`](references/ralph-ledger-review.js) is an advanced, explicitly opt-in Ledger composition that couples each increment to an inlined Review spine.

Adapt [`references/simple-increment.md`](references/simple-increment.md) for the general program or [`references/ledger-increment.md`](references/ledger-increment.md) for either Ledger program. Inline the adapted prompt in the chosen JavaScript body before calling `pi_exec`; do not dynamically load these prompts with `skills.body`.

## Shared inputs and outputs

Every program requires:

- `goal`: a non-empty caller-owned outcome.
- `iterations`: a canonical positive safe-integer string chosen by the caller.
- `stack`: newline-separated repository context paths. It is optional for `ralph-simple.js` and required for the Ledger programs.

The Ledger programs additionally require:

- `task`: the prepared `.ledger/<id>/task.md` whose status governs terminal task stops. The controller adds it to every worker's context stack.

The simple and default Ledger programs return:

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

`completedIterations` counts only workers that returned successfully. `failedAt` identifies the first failed worker. Low-mutation stopping is an adaptable escape hatch, not a completion judgment. Ledger task stops report the task status they observed; they do not independently prove that status is correct.

## Worker contract

Each iteration starts only after the previous one settles:

- **Role:** an untyped fresh worker using the adapted `RALPH` system prompt; do not select a catalog agent type.
- **Profile:** `coding`.
- **Tools:** `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write`.
- **Context:** only the caller-supplied stack and, for reviewed runs, bounded review feedback.

Workers inspect current repository state, choose one coherent increment, implement it, run relevant checks, and stop. They never commit, push, merge, deploy, publish, reset, or decide final integration.

## General bounded loop

Use `ralph-simple.js` when the user wants repeated fresh iterations over a bounded goal but no Ledger task is the authoritative state owner.

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

## Ledger loop

Use `ralph-ledger.js` when a prepared Ledger task owns intent and acceptance, an active plan owns unfinished increments and blocking state, and `evidence/` owns observations.

```javascript
{
  code: "<adapted references/ralph-ledger.js>",
  display: {
    name: "Ledger Ralph loop",
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

Adapt `ledger-increment.md` with the task terminology, acceptance criteria, relevant paths, implementation constraints, likely failure modes, and fastest relevant checks. Preserve its one-increment boundary, Ledger-memory contract, ordinary-tool boundary, no-commit rule, and no-review rule.

## Review ownership

Default Ralph does not plan, review, verify, or close the overall goal. After a Ledger batch, the caller records observed results and review findings under `evidence/`, reconciles progress/remediation in the active plan, and decides whether another bounded batch is useful.

Use `ralph-ledger-review.js` only when the operator explicitly requests the tighter increment-then-review Ledger composition. Adapt the planner, reviewer, and verifier prompt contracts from the `review` skill and inline them in the program. This advanced example does not replace the normal separation between implementation and independent review.

For Ledger work, `review-commissioning` owns bounded specification, plan, Work Item, and fix gates; `implementation-planning` and `plan-execution` own ordinary plan lifecycle; `task-closure` owns closure and integration choices. `ledger_add` only creates tasks and `ledger_close` only archives them.
