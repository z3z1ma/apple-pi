---
name: ledger-execute-task
description: "Interpret and maintain the execution contract for a .ledger task. Use when asked to inspect task readiness, choose or reconcile work items, map work to acceptance criteria, resolve blockers or dependencies, or update task status and evidence from observed results. Not for implementing code or running the Ralph control loop; pi-ralph owns fresh-context execution through pi_exec."
---

# Execute a Ledger Task

Confirm the operator authorized implementation of the named task. Read `task.md`, every governing record, and relevant repository authority with ordinary repository tools before starting. Resolve missing scope, blockers, or dependency problems in shaping, not by weakening the records.

The calling session is the controller. It does not inline review into Ralph, and it does not start an unbounded loop.

1. Choose a bounded iteration count for this batch.
2. Load `/skill:pi-ralph`. Author the program from `skills/pi-ralph/references/ralph.js` with `goal`, a newline-separated `stack` that includes `.ledger/INDEX.md` and `.ledger/<task-id>/task.md`, and `iterations`.
3. Load `/skill:pi-review` and review the working tree against the task contract.
4. Record confirmed findings, evidence, blockers, and work-item honesty in the ledger.
5. Start another bounded Ralph batch if work remains, or stop.

There is no `/ralph` command and no judge role. Do not copy the review workflow into the Ralph program. An optional inlined-review example lives at `skills/pi-ralph/references/ralph-reviewed.js`; it is not the default.

The increment worker updates ledger task records as it works. The operator owns commits, pushes, deploys, and final integration.
