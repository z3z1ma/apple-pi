---
name: ledger-execute-task
description: "Interpret and maintain the execution contract for a .ledger task. Use when asked to inspect task readiness, choose or reconcile work items, map work to acceptance criteria, resolve blockers or dependencies, or update task status and evidence from observed results. Not for implementing code or running the Ralph control loop; pi-ralph owns fresh-context execution through pi_exec."
---

# Execute a Ledger Task

Confirm the operator authorized implementation of the named task. Inspect the task with the `ledger` tool and read the bundle before starting. Resolve missing scope, blockers, or dependency problems in shaping, not by weakening the records.

Ralph is `/skill:pi-ralph`: a `pi_exec` loop around a fresh `general-purpose` agent. The ledger is durable memory. After each increment the program inlines `/skill:pi-review` and feeds confirmed findings into the next fresh window. There is no `/ralph` command, no judge role, and no iteration budget. Raise the `pi_exec` envelope for long-horizon work.

Typical invocation:

```text
/skill:pi-ralph
```

Author a program from `skills/pi-ralph/references/ralph.js`. Required inputs are `goal` and a newline-separated `stack` that includes `.ledger/README.md` and `.ledger/<task-id>/task.md`. Copy planner, reviewer, and verifier prompt bodies from `skills/pi-review/references/` into the program.

The increment worker updates ledger task records as it works. Do not add a loop cap to the program. The operator owns commits, pushes, deploys, and final integration. Independent review outside the loop remains `/skill:pi-review`.
