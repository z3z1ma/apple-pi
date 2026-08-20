---
name: pi-ralph
description: "Run the fresh-context Ralph loop over a prepared .ledger task. Use only when the user explicitly asks to run Ralph, continue Ralph, start a Ralph loop, or invoke pi-ralph for that task. Not for ordinary ledger task execution or readiness, shaping or planning, one-off implementation, or review-only work; ledger-execute-task owns ledger execution semantics."
---

# Ralph

Ralph is an outer loop around a fresh coding agent. The repository is memory. The ledger is the durable pin. Each iteration receives a new context window, chooses one increment, acts, hits ordinary project backpressure, updates ledger records, and dies. The next iteration starts clean.

The calling session is the controller. It chooses how many iterations to run for the given task, commissions reviews with `/skill:pi-review`, edits the ledger, and may start another bounded batch.

## Choose a reference

Use the smallest reference that matches the requested ownership:

- [`references/ralph.js`](references/ralph.js) is the default. It runs a sequential, untyped, write-capable worker for the caller's requested number of fresh increments.
- [`references/increment.md`](references/increment.md) is the adaptable worker-prompt source. Adapt it to the goal before inlining it as the `RALPH` system prompt in `ralph.js`.
- [`references/ralph-reviewed.js`](references/ralph-reviewed.js) is an advanced, explicitly opt-in composition that couples each increment to an inlined review spine. It is not the default and must not redefine the separate default review boundary.

Do not load these program prompts dynamically with `skills.body`; copy the relevant reference into the JavaScript `code` and adapt its placeholders before calling `pi_exec`.

## Inputs and outputs

The default program requires these string inputs:

- `goal`: a non-empty, caller-owned outcome. Keep the worker task short and put only this goal in it.
- `stack`: newline-separated repository paths, normally `.ledger/INDEX.md`, the prepared `.ledger/<id>/task.md`, and a small plan or authority file the fresh worker should open first. Paths are passed through `context`, not dumped into the task.
- `iterations`: a canonical positive safe-integer string. The caller chooses the batch bound; omit no default, use no fractional or exponential form, and do not rely on a hidden loop cap.

The program returns an honest bounded result:

```javascript
{
  status: "completed" | "failed",
  requestedIterations: number,
  completedIterations: number,
  failedAt?: number,
  failures: [{ iteration: number, error: string }],
}
```

`completedIterations` counts only workers that returned successfully. `failedAt` identifies the first failed worker, and the default loop stops there. The result reports worker execution only; it does not judge repository progress or claim that the ledger task is done.

## Worker roles, profiles, and tools

Each default iteration calls `agents.run` only after the previous call settles:

- **Role**: an untyped Ralph program worker with the adapted `RALPH` system prompt; do not set a catalog `type`.
- **Profile**: `coding`, because the worker may implement the selected increment.
- **Tools**: the explicit `RALPH_TOOLS` list: `read`, `grep`, `find`, `ls`, `bash`, `edit`, and `write`. This is a read-and-write implementation lane, not a review lane.
- **Context**: `{ stack }`; the task contains the goal. Each `agents.run` gets a fresh worker context and the next worker observes the prior repository and ledger state.

```javascript
// pi_exec tool arguments
{
  code: "<adapted references/ralph.js>",
  display: {
    name: "Ralph loop",
    description: "Run bounded fresh implementation increments.",
  },
  inputs: {
    goal: "Implement the prepared task. Choose the single most important unfinished increment.",
    stack: ".ledger/INDEX.md\n.ledger/<task-id>/task.md\n.ledger/<task-id>/plans/implementation.md",
    iterations: "4",
  },
}
```

## Adapt the increment prompt

Before execution, adapt [`references/increment.md`](references/increment.md) for the concrete batch. Add the goal's terminology, acceptance criteria, relevant paths, implementation constraints, likely failure modes, and fastest relevant validation commands. Preserve its fresh-context role, one-coherent-increment stop, ledger-memory contract, ordinary-tool boundary, no-commit rule, and no-review rule. Inline the adapted Markdown in `const RALPH`; do not ask the worker to discover or load the prompt reference at runtime.

The worker should read the ledger first, inspect current files, choose one unfinished increment, implement it, run relevant backpressure, and record material results in the ledger. It must leave integration to the caller and must not declare the overall task complete just because its increment returned.

## Default ownership and advanced ownership

The default sequence is:

1. The caller prepares the goal, stack, adapted prompt, and iteration count.
2. `ralph.js` runs fresh coding workers sequentially until the requested bound or the first worker failure.
3. The workers maintain ledger memory; the caller interprets the bounded result.
4. After the batch, the caller separately runs `/skill:pi-review`, records findings, and decides whether another bounded batch is warranted.

Do not inline review, a planner, a verifier, a judge, or a hidden completion loop into default Ralph. Review owns review; ledger-execute-task owns ordinary ledger execution semantics.

Choose `ralph-reviewed.js` only when the caller explicitly wants the advanced increment-then-review composition. That composition is an example of tighter coupling, not a reason to make default Ralph judge progress or to replace the caller-controlled default review step.

Ralph reads and updates ledger files with ordinary repository tools. `ledger_add` is only for creating a new task and `ledger_close` is only for archiving one; after a run, use the ledger skills when the operator authorizes those lifecycle actions. Never commit, push, or reset from the Ralph program; integration remains with the calling session.
