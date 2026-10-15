Status: planning
Created: 2026-10-15
Updated: 2026-10-15

# Evaluate code context sidecars on replayed failure tasks

## Intent

Measure whether code context sidecars (`docs/code-context.md`; built in task `202610141906-code-context-sidecars`) change agent behavior. Replay 3–5 historical tasks where an agent broke a non-derivable constraint, in three configurations:

- **Baseline:** no sidecars delivered.
- **Read-only:** sidecars appended on read, no edit gate.
- **Full v1:** read injection plus the block-and-retry gate.

Compare pre-edit constraint awareness, plan changes after a block, constraint violation rate, and token overhead.

## Open questions for the operator

- Which historical tasks and repositories to replay; candidates may come from `.ledger/history/` or `components/history-eval/`.
- Model, number of runs per configuration, and spending limit.
- How the Read-only configuration is selected (a temporary switch for the experiment, not a product setting).

## Current State

Planning; waits for the operator to choose tasks and budget.

## Outcome

Pending.
