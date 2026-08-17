---
name: ledger-execute-task
description: "Operate a shaped .ledger task through /skill:pi-ralph. Use when asked to run Ralph, execute a ledger task, or continue work from review findings. Not for task shaping or review-only work."
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
