---
name: pi-ralph
description: "Run the fresh-context Ralph loop over a prepared .ledger task. Use only when the user explicitly asks to run Ralph, continue Ralph, start a Ralph loop, or invoke pi-ralph for that task. Not for ordinary ledger task execution or readiness, shaping or planning, one-off implementation, or review-only work; ledger-execute-task owns ledger execution semantics."
---

# Ralph

Ralph is an outer loop around a fresh coding agent. The repository is memory. The ledger is the durable pin. Each iteration receives a new context window, chooses one increment, acts, hits ordinary project backpressure, updates ledger records, and dies. The next iteration starts clean.

Acceptance is a pi-review of the increment. Confirmed findings are the next iteration's work. The program does not use a judge, a completion promise, or an iteration budget. Long-horizon work is unpredictable; raise the `pi_exec` envelope instead of encoding a loop cap.

Workers spawn without skills or extensions. They cannot invoke `/skill:pi-review`. The guest program inlines the review reference and feeds compact findings back.

## Prepare

- **Goal**: the outcome this loop is working toward.
- **Stack**: newline-separated lookup paths. Include the task root (`.ledger/<id>/task.md`) and any small index or plan the next fresh agent should open first. Do not dump file bodies into the task.
- **Envelope**: set `limits` so one increment (one `general-purpose` agent) plus one review cycle (planner, reviewers, verifier) can finish. Increase those host limits for a longer run. Do not add an iteration count to the program.

## Loop

1. **Increment** — spawn `type: "general-purpose"` with no `tools` or `systemPrompt` override. Put Ralph instructions, the goal, and any prior findings in the task. Bind the stack and compact findings as `context`.
2. **Remember** — the agent updates ledger task records as it works. Journal, evidence, blockers, retrospective, distillation, and work items are the memory the next window will read. Leave the increment uncommitted so review can see the working tree.
3. **Review** — snapshot the workspace before the increment. Diff that snapshot afterward. Review the non-ledger product paths through the inlined pi-review spine (partition, parallel review, independent verify). Copy planner, reviewer, and verifier prompt bodies from `skills/pi-review/references/`.
4. **Accept or continue**
   - Product change + confirmed or unresolved findings: feed those findings into the next increment.
   - Product change + clean review: continue so the next fresh agent can take another increment.
   - No product change + empty findings: accept. Ledger-only writes are memory, not unfinished work.
   - No product change while findings remain: stuck, not success.
   - An increment that commits fails. Review reads the working tree, not `HEAD`.

## Program shape

```javascript
// pi_exec tool arguments
{
  code: "<adapted references/ralph.js>",
  display: {
    name: "Ralph loop",
    description: "Fresh increments with ledger memory and pi-review acceptance.",
  },
  inputs: {
    goal: "Implement the task. Choose the single most important unfinished increment.",
    stack: ".ledger/README.md\n.ledger/<task-id>/task.md",
  },
  limits: {
    agentBudget: 48,
    callBudget: 768,
    concurrency: 8,
    timeoutSeconds: 3600,
  },
}
```

Do not pass `tools` or `systemPrompt` to the increment worker. `type: "general-purpose"` keeps the rich agent prompt and the full builtin tool set. Ralph instructions belong in the task.

When authoring, encode `skills/pi-review/references/planner.md`, `reviewer.md`, and `verifier.md` as JavaScript string literals assigned to `PLANNER`, `REVIEWER`, and `VERIFIER`. The increment prompt is the `RALPH` constant in the reference. Pass repository paths and compact finding summaries through `context`.

The `ledger` tool still lists, inspects, selects, and mutates work items. It does not run Ralph. After a run, close or distill the task with the ledger skills when the operator authorizes it.
