---
name: ledger-execute-task
description: "Use when an authorized, shaped .ledger task is ready for bounded Ralph execution and monitoring."
---

# Execute a Ledger Task

Confirm the operator authorized implementation of the named task. Run `ralph inspect` first and resolve graph errors in shaping, not by weakening the records.

Ralph requires a trusted session repository, active model, established Git `HEAD`, clean implementation checkout, and no nested repositories or submodules. The model-facing `ralph` tool is the primary orchestration interface. Its optional `root` targets a linked implementation worktree; `ledger_root` selects the linked checkout containing authoritative `.ledger` and defaults to `root`. Teams may ignore `/.ledger/`; solo developers may commit it.

When the ledger is committed and current in the worktree, use that worktree as `root` and omit `ledger_root`. When the ledger is ignored and remains in the main checkout, pass the worktree as `root` and the main checkout as `ledger_root`. Ralph creates neither worktrees nor commits; those remain explicit orchestrator decisions.

Choose supervised execution when learning or risk is high:

```text
/ralph start .ledger/<task-id>/task.md
/ralph step <run-id>
/ralph status <run-id>
```

Choose autonomous execution only after shaping a bounded task. Ralph derives and records its own package-owned ceilings; ordinary model and slash-command calls do not estimate token, turn, or timeout arithmetic:

```text
/ralph run .ledger/<task-id>/task.md
/ralph run .ledger/<task-id>/task.md --root ../task-worktree --ledger-root /absolute/main-checkout
```

One iteration is a fresh executor, independent grouped review, and a fresh closure judge. Roles do not inherit the parent conversation and are never resumed. Do not edit the checkout while a run is active. Use `/ralph stop <run-id>` to abort and wait for quiescence.

Treat terminal gates honestly:

- `done`: deterministic evidence, review, retrospective, and distillation gates passed;
- `blocked`: shaping, authority, or dependency input is required;
- `evidence_failed` or `review_failed`: inspect the recorded reason before another run;
- `authority_required`, `workspace_conflict`, `compacted`, or `budget_exhausted`: reconcile the workspace and task deliberately; never route around the gate.

Ralph never commits, stages, pushes, deploys, resets, cleans, stashes, publishes, or updates remote systems. The human owns final inspection and integration.
