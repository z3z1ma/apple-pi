---
name: pi-ralph
description: "Run the fresh-context Ralph loop over a prepared .ledger task. Use only when the user explicitly asks to run Ralph, continue Ralph, start a Ralph loop, or invoke pi-ralph for that task. Not for ordinary ledger task execution or readiness, shaping or planning, one-off implementation, or review-only work; ledger-execute-task owns ledger execution semantics."
---

# Ralph

Ralph is an outer loop around a fresh coding agent. The repository is memory. The ledger is the durable pin. Each iteration receives a new context window, chooses one increment, acts, hits ordinary project backpressure, updates ledger records, and dies. The next iteration starts clean.

The calling session is the controller. It chooses how many iterations to run, reviews with `/skill:pi-review`, edits the ledger, and may start another bounded batch. Do not inline review into the default program. Do not invent a judge, a completion promise, or a hidden loop cap.

## Prepare

- **Goal**: the outcome this batch is working toward.
- **Stack**: newline-separated lookup paths. Include the task root (`.ledger/<id>/task.md`) and any small index or plan the next fresh agent should open first. Do not dump file bodies into the task.
- **Iterations**: a positive integer chosen by the calling session for this batch.
- **Envelope**: set `limits` so that many `general-purpose` increments can finish.

## Loop

1. **Increment** — spawn `type: "general-purpose"` with no `tools` or `systemPrompt` override. Put Ralph instructions and the goal in the task. Bind the stack as `context`.
2. **Remember** — the agent updates ledger task records as it works. Journal, evidence, blockers, retrospective, distillation, and work items are the memory the next window will read.
3. **Stop** — after the requested iteration count, or earlier if an increment fails. Return `{ status, iterations, failedAt?, failures }`.

After the program returns, the calling session runs `/skill:pi-review`, records findings in the ledger, and decides whether to start another batch.

## Program shape

```javascript
// pi_exec tool arguments
{
  code: "<adapted references/ralph.js>",
  display: {
    name: "Ralph loop",
    description: "Fresh increments with ledger memory.",
  },
  inputs: {
    goal: "Implement the task. Choose the single most important unfinished increment.",
    stack: ".ledger/README.md\n.ledger/<task-id>/task.md",
    iterations: "4",
  },
  limits: {
    agentBudget: 8,
    callBudget: 256,
    concurrency: 4,
    timeoutSeconds: 3600,
  },
}
```

Do not pass `tools` or `systemPrompt` to the increment worker. `type: "general-purpose"` keeps the rich agent prompt and the full builtin tool set. Ralph instructions belong in the task.

The increment prompt is the `RALPH` constant in the reference. Pass repository paths through `context`.

## Advanced composition

`references/ralph-reviewed.js` inlines the pi-review spine after every increment. That is an example of a tighter coupling, not the default. Prefer the separate skills: this loop, then `/skill:pi-review`.

The `ledger` tool still lists, inspects, selects, and mutates work items. It does not run Ralph. After a run, close or distill the task with the ledger skills when the operator authorizes it.
