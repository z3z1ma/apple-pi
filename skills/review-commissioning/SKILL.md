---
name: review-commissioning
description: "Use when ongoing work needs a deliberately commissioned independent reviewer for a concrete costly or hard-to-observe risk. For an operator-requested end-to-end code review, use review."
---

# Commission One Useful Review

This skill helps the root agent add fresh eyes during ongoing work. Independent review is an expensive risk-control tool, not a lifecycle stage; use it when its expected value exceeds its context, latency, and integration cost.

## When to commission

Good reasons:

- the operator asks specifically for an independent reviewer during ongoing work;
- authorization, security, compatibility, migration, concurrency, cleanup, or persistent-data behavior could fail at high cost;
- a large integrated change has a subtle contract difficult to verify locally;
- the root agent is genuinely stuck after gathering evidence.

Small reversible changes with adequate checks rely on root inspection and the persistent Sentinel. Independent review serves the concrete reasons above.

## One-shot contract

Prepare one complete review assignment:

- intended behavior and exact risk questions;
- comparison boundary and changed paths;
- relevant contract/source paths;
- checks already run and their results;
- known limitations that affect interpretation.

Use the smallest review shape that answers the question. A single read-only reviewer is the default. Multi-lens, planner/reviewer/verifier, or security baselines are reserved for explicitly high-risk changes with genuinely independent questions.

The reviewer should return all material findings in one pass, each with path, trigger, evidence, impact, severity, and smallest correction. It should avoid stylistic preferences and speculative hardening.

## Reconcile once

The root agent owns the result:

1. Verify each material finding against current source and governing intent.
2. Reject false positives with evidence.
3. Fix confirmed issues directly.
4. Treat nits as optional; take them only when cheap and clearly better.
5. Rerun the affected checks.

Nits and ordinary disagreements conclude in the root. One scoped follow-up review serves a material high-risk fix that remains difficult to verify through code and tests. Otherwise the root's reconciliation ends the review.

## Ledger

When a Ledger task already uses durable review evidence, record only material findings, dispositions, and residual risk needed by a future session. If a preferred review mechanism fails, use another bounded mechanism only when the original risk still justifies the cost.

## Severity

- `critical`: realistic security compromise, data loss/corruption, or catastrophic outage.
- `significant`: reachable contract break or operational failure that should block completion.
- `minor`: bounded issue that can be fixed directly or deferred without another cycle.

Review is complete when the root has reconciled the one-pass findings and rerun relevant checks. It does not require reviewer approval of the fixes unless the original risk explicitly warranted the scoped follow-up.
