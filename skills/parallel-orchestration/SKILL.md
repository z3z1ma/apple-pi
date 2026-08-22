---
name: parallel-orchestration
description: "Use when two or more substantial, non-overlapping problem domains can progress independently and parallel delegation clearly saves time."
---

# Parallelize Only Real Independence

Parallel agents are expensive. Use them when independent work can genuinely overlap without repeated context loading, shared writes, or coordination churn.

## Entry test

Parallelize only when all are true:

- at least two substantial domains are independently actionable;
- each has clear ownership and a self-contained outcome;
- writers have disjoint files and mutable state;
- the root session can integrate the results;
- expected wall-clock savings exceed dispatch and reconciliation cost.

Several tiny edits, sequential dependencies, speculative investigations, and work the root can finish quickly stay in the root session.

## Dispatch once per domain

Give each worker one complete assignment containing:

- outcome and exact owned paths;
- relevant contract and interfaces;
- non-goals;
- checks to run;
- report format;
- no-child-delegation rule.

Use the fewest agents that cover the independent domains. Batch same-shape edits and assign disjoint writer ownership.

## Root coordination

While workers run, the root may inspect shared integration surfaces or prepare non-overlapping work. Results arrive through bounded waits; review begins after implementation settles.

When results arrive:

1. inspect each actual diff and report;
2. verify boundaries and interfaces;
3. resolve ordinary integration issues and nits in the root;
4. run combined relevant checks;
5. commission at most one integrated review only when the final risk tier warrants it.

Minor feedback concludes in the root. Resume a worker for a materially incomplete assignment where its retained context remains the cheapest path.

## Failure handling

- one worker fails: preserve successful independent results and take over or retry with changed context;
- dependency discovered: stop parallel writes and sequence the remaining work;
- conflict discovered: choose one owner and reconcile in the root;
- scope ambiguity: ask only if it changes observable behavior or authority.

## Ledger

When a Ledger plan exists, record owners and dependency edges when they help recovery. Worker reports are claims; concise validated outcomes are enough.

Parallel orchestration ends after integration and combined checks. It does not imply per-worker review, re-review, or a final multi-agent tribunal.
